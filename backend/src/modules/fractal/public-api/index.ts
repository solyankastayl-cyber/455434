/**
 * FRACTAL MODULE — Public API
 * 
 * This is the SINGLE ENTRY POINT for the Fractal module.
 * All external code should import from this file only.
 * 
 * The module exposes:
 * - FractalModule interface and factory function
 * - Type definitions for DTOs and configuration
 * - Freeze guard for core integration
 * - Frontend configuration (routes, menus, dashboards)
 * 
 * IMPORTANT: Do not import internal services directly.
 * Use the public API methods instead.
 * 
 * @version v2.0-fractal-stable
 * @example
 * ```typescript
 * import { 
 *   createFractalModule, 
 *   fractalRoutes, 
 *   freezeGuard,
 *   type FractalModule,
 *   type DashboardDto 
 * } from '@modules/fractal/public-api';
 * 
 * // Create module instance
 * const fractal = createFractalModule({
 *   frozen: true,
 *   freezeVersion: 'v2.0-fractal-stable',
 *   mongoDb: coreDb,
 *   allowedJobs: ['full', 'resolve_matured', 'health']
 * });
 * 
 * // Use module
 * const dashboard = await fractal.getDashboard('BTC');
 * const forecast = await fractal.getTerminal('BTC', '14d');
 * ```
 */

// ═══════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════

export type {
  // Core types
  Scope,
  Horizon,
  BtcHorizon,
  SpxHorizon,
  DxyHorizon,
  CrossAssetHorizon,
  
  // Config types
  MongoDbAdapter,
  FractalConfig,
  
  // DTO types
  DashboardDto,
  ForecastDto,
  DriftDto,
  HealthDto,
  JobResult,
  FreezeManifest,
  
  // Module interface
  FractalModule,
  
  // Frontend config types
  FractalRoutesConfig,
  FractalMenuConfig,
  FractalDashboardConfig,
  
  // Freeze guard
  FreezeGuard
} from './types.js';

// ═══════════════════════════════════════════════════════════════
// MODULE FACTORY
// ═══════════════════════════════════════════════════════════════

export { 
  createFractalModule,
  createDefaultConfig,
  FractalModuleImpl 
} from './module.impl.js';

// ═══════════════════════════════════════════════════════════════
// FREEZE GUARD
// ═══════════════════════════════════════════════════════════════

export { 
  freezeGuard,
  isFrozen,
  setFrozen,
  isBlockedRoute,
  createFreezeMiddleware 
} from './freeze.guard.js';

// ═══════════════════════════════════════════════════════════════
// FRONTEND CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export {
  fractalRoutes,
  fractalMenuConfig,
  fractalDashboardConfig,
  fractalApiEndpoints,
  horizonsByScope,
  defaultHorizonByScope,
  healthGradeThresholds,
  driftSeverityThresholds,
  allowedJobsInFrozenState,
  blockedPatternsInFrozenState
} from './config.js';
