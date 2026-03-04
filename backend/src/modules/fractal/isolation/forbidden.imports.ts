/**
 * BLOCK B.3 — Forbidden Imports Registry
 * Список запрещённых импортов для изоляции Fractal модуля
 */

// ═══════════════════════════════════════════════════════════════
// FORBIDDEN IMPORTS CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface ForbiddenImportRule {
  pattern: string | RegExp;
  reason: string;
  severity: 'error' | 'warning';
  allowedIn?: string[]; // Files where this import IS allowed
}

export const FORBIDDEN_IMPORTS: ForbiddenImportRule[] = [
  // ═══════════════════════════════════════════════════════════
  // EXTERNAL HTTP CLIENTS — Must use HostDeps.http
  // ═══════════════════════════════════════════════════════════
  {
    pattern: /^axios$/,
    reason: 'Direct axios import forbidden. Use FractalHostDeps.http instead.',
    severity: 'error',
  },
  {
    pattern: /^node-fetch$/,
    reason: 'Direct node-fetch import forbidden. Use FractalHostDeps.http instead.',
    severity: 'error',
  },
  {
    pattern: /^got$/,
    reason: 'Direct got import forbidden. Use FractalHostDeps.http instead.',
    severity: 'error',
  },

  // ═══════════════════════════════════════════════════════════
  // DATABASE DRIVERS — Must use HostDeps.db
  // ═══════════════════════════════════════════════════════════
  {
    pattern: /^mongoose$/,
    reason: 'Direct mongoose import forbidden in domain logic. Use FractalHostDeps.db instead.',
    severity: 'error',
    allowedIn: ['storage/', 'data/'],
  },
  {
    pattern: /^mongodb$/,
    reason: 'Direct mongodb driver import forbidden. Use FractalHostDeps.db instead.',
    severity: 'error',
    allowedIn: ['storage/', 'data/'],
  },

  // ═══════════════════════════════════════════════════════════
  // PROCESS/ENV DIRECT ACCESS — Must use HostDeps.settings
  // ═══════════════════════════════════════════════════════════
  {
    pattern: /process\.env\./,
    reason: 'Direct process.env access forbidden in domain logic. Use FractalHostDeps.settings instead.',
    severity: 'warning',
    allowedIn: ['config/', 'bootstrap/', 'runtime/'],
  },

  // ═══════════════════════════════════════════════════════════
  // OTHER DOMAIN MODULES — Fractal must be self-contained
  // ═══════════════════════════════════════════════════════════
  {
    pattern: /\.\.\/\.\.\/core\//,
    reason: 'Direct import from core module forbidden. Fractal must be isolated.',
    severity: 'error',
  },
  {
    pattern: /\.\.\/\.\.\/modules\/(?!fractal)/,
    reason: 'Cross-module import forbidden. Fractal must be self-contained.',
    severity: 'error',
  },

  // ═══════════════════════════════════════════════════════════
  // TELEGRAM DIRECT — Must use HostDeps.telegram
  // ═══════════════════════════════════════════════════════════
  {
    pattern: /telegraf|node-telegram-bot-api/,
    reason: 'Direct Telegram library import forbidden. Use FractalHostDeps.telegram instead.',
    severity: 'error',
    allowedIn: ['ops/', 'infra/'],
  },
];

// ═══════════════════════════════════════════════════════════════
// ALLOWED IMPORTS (whitelist for clarity)
// ═══════════════════════════════════════════════════════════════

export const ALLOWED_EXTERNAL_IMPORTS = [
  'fastify',           // App framework (injected via HostDeps.app)
  'zod',              // Schema validation (pure, no side effects)
  'technicalindicators', // Math library (pure functions)
  'uuid',             // ID generation (pure)
];

// ═══════════════════════════════════════════════════════════════
// FRACTAL MODULE BOUNDARIES
// ═══════════════════════════════════════════════════════════════

export const FRACTAL_MODULE_PATHS = {
  root: 'src/modules/fractal',
  
  // These directories CAN have external dependencies
  infrastructure: [
    'src/modules/fractal/storage',
    'src/modules/fractal/data',
    'src/modules/fractal/ops',
    'src/modules/fractal/runtime',
    'src/modules/fractal/bootstrap',
  ],
  
  // These directories MUST be pure (no external deps)
  domain: [
    'src/modules/fractal/engine',
    'src/modules/fractal/domain',
    'src/modules/fractal/contracts',
    'src/modules/fractal/strategy',
  ],
};

// ═══════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════

export interface ImportViolation {
  file: string;
  line: number;
  importPath: string;
  rule: ForbiddenImportRule;
}

export interface IsolationReport {
  ok: boolean;
  violations: ImportViolation[];
  warnings: ImportViolation[];
  checkedFiles: number;
  timestamp: string;
}
