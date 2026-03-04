/**
 * FRACTAL MODULE — Public API Types
 * 
 * These types define the public contract between the Fractal module
 * and any core system that integrates it.
 * 
 * IMPORTANT: These types are FROZEN and should not be modified
 * without careful consideration of backwards compatibility.
 * 
 * @version v2.0-fractal-stable
 */

// ═══════════════════════════════════════════════════════════════
// SCOPE & HORIZON TYPES
// ═══════════════════════════════════════════════════════════════

export type Scope = 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';

export type BtcHorizon = '7d' | '14d' | '30d' | '90d';
export type SpxHorizon = '5d' | '10d' | '21d' | '63d';
export type DxyHorizon = '5d' | '10d' | '21d';
export type CrossAssetHorizon = '7d' | '14d' | '30d';

export type Horizon = BtcHorizon | SpxHorizon | DxyHorizon | CrossAssetHorizon;

// ═══════════════════════════════════════════════════════════════
// CONFIG TYPES
// ═══════════════════════════════════════════════════════════════

export interface MongoDbAdapter {
  getCollection: (name: string) => any;
  getDb: () => any;
}

export interface FractalConfig {
  frozen: boolean;
  freezeVersion: string;
  mongoDb: MongoDbAdapter;
  allowedJobs: string[];
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD DTO
// ═══════════════════════════════════════════════════════════════

export interface DashboardDto {
  scope: Scope;
  timestamp: string;
  frozen: boolean;
  
  // Current signal
  signal: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    horizon: Horizon;
    matchCount: number;
  };
  
  // Health status
  health: {
    grade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    hitRate: number;
    avgAbsError: number;
    sampleCount: number;
    lastUpdated: string;
  };
  
  // Drift status
  drift: {
    severity: 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
    delta: number;
    trend: 'STABLE' | 'INCREASING' | 'DECREASING';
  };
  
  // Lifecycle state
  lifecycle: {
    currentVersion: string;
    state: 'ACTIVE' | 'SHADOW' | 'DEPRECATED';
    lastPromoted: string | null;
  };
}

// ═══════════════════════════════════════════════════════════════
// FORECAST DTO (Terminal)
// ═══════════════════════════════════════════════════════════════

export interface ForecastDto {
  scope: Scope;
  horizon: Horizon;
  timestamp: string;
  
  // Primary forecast
  forecast: {
    direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    confidence: number;
    expectedMove: number;
    expectedMovePercent: number;
  };
  
  // Match details
  matches: {
    count: number;
    avgSimilarity: number;
    topMatchDate: string;
    topMatchSimilarity: number;
  };
  
  // Context
  context: {
    regime: string;
    volatility: 'LOW' | 'MEDIUM' | 'HIGH';
    phase: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// DRIFT DTO
// ═══════════════════════════════════════════════════════════════

export interface DriftDto {
  scope: Scope;
  timestamp: string;
  
  // Overall drift
  overall: {
    severity: 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
    delta: number;
    trend: 'STABLE' | 'INCREASING' | 'DECREASING';
  };
  
  // By horizon breakdown
  byHorizon: Array<{
    horizon: Horizon;
    severity: 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';
    delta: number;
  }>;
  
  // Rolling window
  rolling: {
    window: number;
    avgDelta: number;
    maxDelta: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH DTO
// ═══════════════════════════════════════════════════════════════

export interface HealthDto {
  scope: Scope;
  timestamp: string;
  
  // Grade
  grade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  
  // Metrics
  metrics: {
    hitRate: number;
    avgAbsError: number;
    sampleCount: number;
    staleHours: number;
  };
  
  // By horizon
  byHorizon: Array<{
    horizon: Horizon;
    grade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    hitRate: number;
    sampleCount: number;
  }>;
  
  // Alerts
  alerts: Array<{
    type: 'STALE_DATA' | 'LOW_HIT_RATE' | 'HIGH_ERROR' | 'DRIFT_CRITICAL';
    message: string;
    severity: 'WARNING' | 'CRITICAL';
  }>;
}

// ═══════════════════════════════════════════════════════════════
// JOB RESULT
// ═══════════════════════════════════════════════════════════════

export interface JobResult {
  success: boolean;
  job: string;
  duration: number;
  timestamp: string;
  details?: {
    processed?: number;
    resolved?: number;
    errors?: number;
    message?: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// FREEZE MANIFEST
// ═══════════════════════════════════════════════════════════════

export interface FreezeManifest {
  version: string;
  freezeDate: string;
  gitCommitSha: string;
  tag: string;
  buildTimestamp: string;
  
  horizonPolicy: {
    [key in Scope]?: {
      horizons: Horizon[];
      windowLenStrategy: string;
      minSamples: number;
      defaultHorizon: Horizon;
    };
  };
  
  healthThresholds: {
    grades: {
      HEALTHY: { hitRateMin: number; maxAvgAbsError: number };
      DEGRADED: { hitRateMin: number; maxAvgAbsError: number };
      CRITICAL: { hitRateMin: number; maxAvgAbsError: number };
    };
    minSamplesForGrade: number;
    staleAfterHours: number;
  };
  
  driftThresholds: {
    severity: {
      OK: { maxDelta: number };
      WATCH: { maxDelta: number };
      WARN: { maxDelta: number };
      CRITICAL: { maxDelta: number };
    };
  };
  
  allowedJobs: string[];
  blockedPatterns: string[];
  
  auditInfo: {
    frozenBy: string;
    reason: string;
    freezeAuditPassed: boolean;
    testsPassed: number;
    testsFailed: number;
    lastAuditDate: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// FRACTAL MODULE INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface FractalModule {
  /**
   * Get dashboard data for a scope
   */
  getDashboard(scope: Scope): Promise<DashboardDto>;
  
  /**
   * Get forecast terminal data
   */
  getTerminal(scope: Scope, horizon: Horizon): Promise<ForecastDto>;
  
  /**
   * Get drift analysis
   */
  getDrift(scope: Scope): Promise<DriftDto>;
  
  /**
   * Get health status
   */
  getHealth(scope: Scope): Promise<HealthDto>;
  
  /**
   * Run a maintenance job (idempotent)
   * Only allowed jobs: 'resolve' | 'health' | 'full'
   */
  runMaintenanceJob(type: 'resolve' | 'health' | 'full'): Promise<JobResult>;
  
  /**
   * Check if system is frozen
   */
  isFrozen(): boolean;
  
  /**
   * Get freeze manifest
   */
  getFreezeManifest(): FreezeManifest;
  
  /**
   * Module metadata
   */
  getMetadata(): {
    version: string;
    frozen: boolean;
    scopes: Scope[];
    initialized: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// FRONTEND CONFIG TYPES
// ═══════════════════════════════════════════════════════════════

export interface FractalRoutesConfig {
  admin: string;
  dashboard: string;
  drift: string;
  health: string;
  lifecycle: string;
}

export interface FractalMenuConfig {
  id: string;
  label: string;
  labelRu: string;
  icon: string;
  routes: FractalRoutesConfig;
  permissions: string[];
}

export interface FractalDashboardConfig {
  scopes: Scope[];
  defaultScope: Scope;
  tabs: string[];
  features: {
    seedToggle: boolean;
    devControls: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// FREEZE GUARD INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface FreezeGuard {
  isFrozen: () => boolean;
  isBlocked: (url: string, method: string) => boolean;
  getManifest: () => FreezeManifest;
  getAllowedJobs: () => string[];
  getBlockedPatterns: () => string[];
}
