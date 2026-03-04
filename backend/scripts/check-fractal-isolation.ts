#!/usr/bin/env npx tsx
/**
 * BLOCK B.4 — Fractal Isolation Linting Script
 * Детекция запрещённых импортов в Fractal модуле
 */

import * as fs from 'fs';
import * as path from 'path';

const FRACTAL_ROOT = 'src/modules/fractal';

interface ForbiddenImportRule {
  pattern: RegExp;
  reason: string;
  severity: 'error' | 'warning';
  allowedIn?: string[];
}

const FORBIDDEN_IMPORTS: ForbiddenImportRule[] = [
  { pattern: /from ['"]axios['"]/, reason: 'Use FractalHostDeps.http', severity: 'error' },
  { pattern: /from ['"]node-fetch['"]/, reason: 'Use FractalHostDeps.http', severity: 'error' },
  { pattern: /from ['"]mongoose['"]/, reason: 'Use FractalHostDeps.db', severity: 'error', allowedIn: ['storage/', 'data/', 'governance/', 'lifecycle/'] },
  { pattern: /from ['"]mongodb['"]/, reason: 'Use FractalHostDeps.db', severity: 'error', allowedIn: ['storage/', 'data/', 'governance/', 'lifecycle/'] },
  { pattern: /process\.env\.\w+/, reason: 'Use FractalHostDeps.settings', severity: 'warning', allowedIn: ['config/', 'bootstrap/', 'runtime/', 'ops/', 'freeze/', 'api/'] },
  { pattern: /from ['"]\.\.\/\.\.\/core\//, reason: 'Fractal must be isolated from core', severity: 'error' },
];

interface Violation { file: string; line: number; content: string; rule: ForbiddenImportRule; }

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  function walk(currentDir: string) {
    if (!fs.existsSync(currentDir)) return;
    const items = fs.readdirSync(currentDir);
    for (const item of items) {
      const fullPath = path.join(currentDir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && !['node_modules', 'dist', '__tests__'].includes(item)) {
        walk(fullPath);
      } else if (item.endsWith('.ts') && !item.endsWith('.test.ts')) {
        files.push(fullPath);
      }
    }
  }
  walk(dir);
  return files;
}

function isAllowedIn(filePath: string, allowedPaths?: string[]): boolean {
  if (!allowedPaths) return false;
  return allowedPaths.some(allowed => filePath.includes(allowed));
}

function checkFile(filePath: string): Violation[] {
  const violations: Violation[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of FORBIDDEN_IMPORTS) {
      if (rule.pattern.test(lines[i]) && !isAllowedIn(filePath, rule.allowedIn)) {
        violations.push({ file: filePath, line: i + 1, content: lines[i].trim(), rule });
      }
    }
  }
  return violations;
}

function main() {
  const ciMode = process.argv.includes('--ci');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('     FRACTAL MODULE ISOLATION CHECK - BLOCK B.4');
  console.log('═══════════════════════════════════════════════════════════');
  
  const fractalPath = path.join(process.cwd(), FRACTAL_ROOT);
  if (!fs.existsSync(fractalPath)) { 
    console.error('❌ Fractal module not found at:', fractalPath); 
    process.exit(1); 
  }
  
  const files = getAllTsFiles(fractalPath);
  console.log(`\n📁 Scanning ${files.length} TypeScript files...\n`);
  
  const allViolations: Violation[] = [];
  for (const file of files) { 
    allViolations.push(...checkFile(file)); 
  }
  
  const errors = allViolations.filter(v => v.rule.severity === 'error');
  const warnings = allViolations.filter(v => v.rule.severity === 'warning');
  
  if (errors.length > 0) {
    console.log(`❌ ERRORS (${errors.length}):`);
    for (const v of errors) {
      console.log(`   ${path.relative(process.cwd(), v.file)}:${v.line}`);
      console.log(`   → ${v.rule.reason}\n`);
    }
  }
  
  if (warnings.length > 0) {
    console.log(`⚠️  WARNINGS (${warnings.length}):`);
    for (const v of warnings) {
      console.log(`   ${path.relative(process.cwd(), v.file)}:${v.line}`);
      console.log(`   → ${v.rule.reason}\n`);
    }
  }
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📊 Summary: ${files.length} files | ${errors.length} errors | ${warnings.length} warnings`);
  
  if (errors.length === 0) {
    console.log('✅ ISOLATION CHECK PASSED');
  } else {
    console.log('❌ ISOLATION CHECK FAILED');
  }
  
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/isolation-report.json', JSON.stringify({ 
    ok: errors.length === 0, 
    errors: errors.length,
    warnings: warnings.length,
    checkedFiles: files.length,
    timestamp: new Date().toISOString()
  }, null, 2));
  
  console.log('📝 Report: tmp/isolation-report.json\n');
  
  if (ciMode && errors.length > 0) process.exit(1);
}

main();
