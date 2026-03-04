/**
 * FRACTAL MODULE — Public Configuration
 * 
 * Frontend routes, menu configuration, and dashboard settings
 * for integrating the Fractal module into a core system.
 * 
 * @version v2.0-fractal-stable
 */

import type {
  FractalRoutesConfig,
  FractalMenuConfig,
  FractalDashboardConfig,
  Scope
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// ROUTES CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const fractalRoutes: FractalRoutesConfig = {
  admin: '/admin/fractal',
  dashboard: '/admin/fractal?tab=overview',
  drift: '/admin/fractal?tab=drift',
  health: '/admin/fractal?tab=health',
  lifecycle: '/admin/fractal?tab=lifecycle'
};

// ═══════════════════════════════════════════════════════════════
// MENU CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const fractalMenuConfig: FractalMenuConfig = {
  id: 'fractal',
  label: 'Fractal Models',
  labelRu: 'Фрактальные модели',
  icon: 'chart-line',
  routes: fractalRoutes,
  permissions: ['admin', 'viewer']
};

// ═══════════════════════════════════════════════════════════════
// DASHBOARD CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const fractalDashboardConfig: FractalDashboardConfig = {
  scopes: ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'] as Scope[],
  defaultScope: 'BTC' as Scope,
  tabs: ['overview', 'lifecycle', 'drift', 'health', 'governance', 'history'],
  features: {
    seedToggle: false,  // Disabled in production
    devControls: false  // Disabled in production
  }
};

// ═══════════════════════════════════════════════════════════════
// API ENDPOINTS CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export const fractalApiEndpoints = {
  // Terminal (public)
  terminal: {
    btc: '/api/fractal/v2.1/terminal?asset=BTC',
    spx: '/api/spx/terminal',
    dxy: '/api/dxy/terminal',
    crossAsset: '/api/cross-asset/terminal'
  },
  
  // Admin
  admin: {
    overview: '/api/fractal/v2.1/admin/overview',
    drift: '/api/fractal/v2.1/admin/drift',
    health: '/api/fractal/v2.1/admin/health',
    lifecycle: '/api/fractal/v2.1/admin/lifecycle',
    freezeStatus: '/api/admin/freeze-status'
  },
  
  // Jobs
  jobs: {
    run: '/api/admin/jobs/run',
    status: '/api/admin/jobs/status'
  },
  
  // Health
  health: '/api/health'
};

// ═══════════════════════════════════════════════════════════════
// HORIZON CONFIGURATION BY SCOPE
// ═══════════════════════════════════════════════════════════════

export const horizonsByScope = {
  BTC: ['7d', '14d', '30d', '90d'] as const,
  SPX: ['5d', '10d', '21d', '63d'] as const,
  DXY: ['5d', '10d', '21d'] as const,
  CROSS_ASSET: ['7d', '14d', '30d'] as const
};

export const defaultHorizonByScope = {
  BTC: '14d',
  SPX: '21d',
  DXY: '10d',
  CROSS_ASSET: '14d'
} as const;

// ═══════════════════════════════════════════════════════════════
// GRADE THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const healthGradeThresholds = {
  HEALTHY: { hitRateMin: 0.50, maxAvgAbsError: 5.0 },
  DEGRADED: { hitRateMin: 0.45, maxAvgAbsError: 7.0 },
  CRITICAL: { hitRateMin: 0.0, maxAvgAbsError: 999 }
};

export const driftSeverityThresholds = {
  OK: { maxDelta: 0.02 },
  WATCH: { maxDelta: 0.05 },
  WARN: { maxDelta: 0.10 },
  CRITICAL: { maxDelta: 0.15 }
};

// ═══════════════════════════════════════════════════════════════
// ALLOWED OPERATIONS IN FROZEN STATE
// ═══════════════════════════════════════════════════════════════

export const allowedJobsInFrozenState = [
  'full',
  'resolve_matured',
  'health',
  'health_check'
];

export const blockedPatternsInFrozenState = [
  'POST /api/*/lifecycle/promote',
  'POST /api/*/lifecycle/rollback',
  'PATCH /api/*/model-config',
  'POST /api/*/model-config',
  'POST /api/admin/jobs/run?job=seed*',
  'POST /api/admin/jobs/run?job=backfill',
  'POST /api/admin/jobs/run?job=reset',
  'POST /api/*/lifecycle/drift',
  'POST /api/*/lifecycle/samples',
  'POST /api/*/lifecycle/constitution',
  'POST /api/*/lifecycle/integrity'
];
