/**
 * DXY ISOLATION TEST
 * 
 * Ensures DXY module does not import from BTC or SPX modules
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DXY_MODULE_PATH = path.resolve(__dirname, '../');

const FORBIDDEN_IMPORTS = [
  '/modules/btc',
  '/modules/spx',
  'from \'../btc',
  'from \'../spx',
  'from \'../../btc',
  'from \'../../spx',
  'from "../btc',
  'from "../spx',
  'from "../../btc',
  'from "../../spx',
];

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(fullPath));
    } else if (item.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

function checkIsolation(): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const files = getAllTsFiles(DXY_MODULE_PATH);
  
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const relativePath = path.relative(DXY_MODULE_PATH, file);
    
    for (const forbidden of FORBIDDEN_IMPORTS) {
      if (content.includes(forbidden)) {
        violations.push(`${relativePath}: contains '${forbidden}'`);
      }
    }
  }
  
  return {
    ok: violations.length === 0,
    violations,
  };
}

// Run test
const result = checkIsolation();

if (result.ok) {
  console.log('✅ DXY ISOLATION TEST PASSED');
  console.log('   No imports from BTC or SPX modules found');
} else {
  console.error('❌ DXY ISOLATION TEST FAILED');
  console.error('   Violations:');
  result.violations.forEach(v => console.error(`   - ${v}`));
  process.exit(1);
}

export { checkIsolation };
