/**
 * BLOCK B3 — Fractal Import Guard Script
 * 
 * Static analysis script that validates:
 * - No forbidden imports in fractal module
 * - No direct process.env access (except allowed dirs)
 * - No cross-module imports
 * - No forbidden patterns (timers, cron, etc.)
 * 
 * Run: npx tsx scripts/fractal_import_guard.ts
 * CI: npm run guard:fractal
 */

import * as fs from 'fs';
import * as path from 'path';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  rootDir: 'src/modules/fractal',
  includeExtensions: ['.ts', '.tsx', '.js', '.jsx'],
  
  forbiddenImportSubstrings: [
    '/modules/metabrain/',
    '/modules/exchange/',
    '/modules/sentiment/',
    '/app/core/',
    '/shared/'
  ],
  
  forbiddenExactModules: [
    'axios',
    'node-fetch',
    'got'
  ],
  
  forbiddenPatterns: [
    { pattern: 'process.env', allowedIn: ['config/', 'bootstrap/', 'runtime/', 'ops/', 'freeze/', 'api/', 'alerts/'] },
    { pattern: 'setInterval(', allowedIn: [] },
    { pattern: 'setTimeout(', allowedIn: ['ops/', 'jobs/', 'data/providers/', 'alerts/'] },
    { pattern: 'new CronJob(', allowedIn: [] },
    { pattern: 'cron.schedule(', allowedIn: [] }
  ],
  
  allowlistPaths: [
    'src/modules/fractal/isolation/',
    'src/modules/fractal/host/',
    'src/modules/fractal/runtime/'
  ]
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

interface Violation {
  file: string;
  type: 'FORBIDDEN_IMPORT' | 'FORBIDDEN_MODULE' | 'FORBIDDEN_PATTERN';
  detail: string;
  line?: number;
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.next', '__tests__'].includes(e.name)) continue;
      walk(full, exts, out);
    } else {
      if (exts.includes(path.extname(e.name))) out.push(full);
    }
  }
  return out;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

function isAllowedFor(filePath: string, allowedDirs: string[]): boolean {
  const norm = normalize(filePath);
  return allowedDirs.some(dir => norm.includes(dir));
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

function main() {
  const repoRoot = process.cwd();
  const rootDirAbs = path.join(repoRoot, CONFIG.rootDir);
  
  if (!fs.existsSync(rootDirAbs)) {
    console.error(`❌ rootDir not found: ${rootDirAbs}`);
    process.exit(2);
  }
  
  const files = walk(rootDirAbs, CONFIG.includeExtensions);
  const violations: Violation[] = [];
  
  console.log(`🔍 Scanning ${files.length} files in ${CONFIG.rootDir}...`);
  
  const importRegex = /(?:import\s+[^;]*?\s+from\s+['"]([^'"]+)['"]\s*;?)|(?:require\(\s*['"]([^'"]+)['"]\s*\))/g;
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relPath = normalize(file);
    
    // Skip allowlisted paths
    const isAllowlisted = CONFIG.allowlistPaths.some(p => relPath.includes(p));
    
    // 1) Check forbidden patterns
    if (!isAllowlisted) {
      for (const pat of CONFIG.forbiddenPatterns) {
        if (isAllowedFor(relPath, pat.allowedIn)) continue;
        
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(pat.pattern)) {
            violations.push({
              file: relPath,
              type: 'FORBIDDEN_PATTERN',
              detail: pat.pattern,
              line: idx + 1
            });
          }
        });
      }
    }
    
    // 2) Check imports
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const mod = (match[1] || match[2] || '').trim();
      if (!mod) continue;
      
      // Exact forbidden modules
      if (CONFIG.forbiddenExactModules.includes(mod)) {
        violations.push({
          file: relPath,
          type: 'FORBIDDEN_MODULE',
          detail: mod
        });
        continue;
      }
      
      // Substring forbidden import paths
      for (const bad of CONFIG.forbiddenImportSubstrings) {
        if (mod.includes(bad)) {
          violations.push({
            file: relPath,
            type: 'FORBIDDEN_IMPORT',
            detail: mod
          });
          break;
        }
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // RESULT
  // ═══════════════════════════════════════════════════════════════
  
  if (violations.length === 0) {
    console.log('✅ Fractal Import Guard: PASS (no boundary violations)');
    console.log(`   Checked ${files.length} files`);
    process.exit(0);
  }
  
  console.error('❌ Fractal Import Guard: FAIL');
  console.error('');
  
  for (const v of violations) {
    const loc = v.line ? `:${v.line}` : '';
    console.error(`  ${v.file}${loc}`);
    console.error(`    → ${v.type}: ${v.detail}`);
  }
  
  console.error('');
  console.error('Fix: Remove forbidden imports/patterns or move logic behind HostDeps.');
  console.error(`Total violations: ${violations.length}`);
  
  process.exit(1);
}

main();
