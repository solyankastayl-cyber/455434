/**
 * UNIFIED LIFECYCLE ENGINE — TYPES
 * 
 * BLOCK L1 + L2 — Lifecycle types with full observability
 */

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type ModelId = 'BTC' | 'SPX' | 'COMBINED';
export type SystemMode = 'DEV' | 'PROD';
export type LifecycleStatus = 'SIMULATION' | 'WARMUP' | 'APPLIED' | 'APPLIED_MANUAL' | 'REVOKED';
export type DriftSeverity = 'OK' | 'WATCH' | 'WARN' | 'CRITICAL';

export type LifecycleEventType =
  | 'GENERATED'
  | 'PROPOSED'
  | 'WARMUP_START'
  | 'WARMUP_PROGRESS'
  | 'AUTO_APPLY'
  | 'FORCE_APPLY'
  | 'FORCE_WARMUP'
  | 'REVOKE'
  | 'RESET_SIMULATION'
  | 'DRIFT_WARN'
  | 'DRIFT_CRITICAL'
  | 'CONSTITUTION_UPDATE'
  | 'DEV_TRUTH_MODE';

// ═══════════════════════════════════════════════════════════════
// STATE STRUCTURES
// ═══════════════════════════════════════════════════════════════

export interface WarmupState {
  startedAt: string | null;
  targetDays: number;
  resolvedDays: number;
  progressPct: number;
}

export interface LiveState {
  liveSamples: number;
  liveOutcomes: number;
  lastLiveAsOfDate: string | null;
}

export interface DriftState {
  severity: DriftSeverity;
  lastCheckedAt: string | null;
  deltaHitRate?: number;
  deltaSharpe?: number;
  deltaCalibration?: number;
}

export interface LifecycleMetrics {
  sharpe: number;
  hitRate: number;
  maxDrawdown: number;
  expectancy: number;
  samples: number;
}

// ═══════════════════════════════════════════════════════════════
// MAIN STATE MODEL
// ═══════════════════════════════════════════════════════════════

export interface ModelLifecycleState {
  modelId: ModelId;
  engineVersion: string;
  systemMode: SystemMode;
  status: LifecycleStatus;
  
  // Constitution
  constitutionHash: string | null;
  governanceAppliedAt: string | null;
  
  // Warmup tracking
  warmup: WarmupState;
  
  // Live tracking
  live: LiveState;
  
  // Drift monitoring
  drift: DriftState;
  
  // Historical metrics snapshot
  historicalMetrics?: LifecycleMetrics;
  
  // Live metrics snapshot
  liveMetrics?: LifecycleMetrics;
  
  // Validation result
  validationResult?: {
    passed: boolean;
    checks: Record<string, { passed: boolean; live?: number; hist?: number; tolerance?: number }>;
    reason: string;
  };
  
  // Operations tracking
  lastOps?: {
    dailyRunAt?: string | null;
    calibrationAt?: string | null;
  };
  
  // Last transition
  lastTransition?: {
    from: LifecycleStatus;
    to: LifecycleStatus;
    reason: string;
    actor: 'SYSTEM' | 'ADMIN';
    timestamp: string;
    note?: string;
  };
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

export interface LifecycleEvent {
  modelId: ModelId;
  engineVersion: string;
  ts: string;
  type: LifecycleEventType;
  actor: 'SYSTEM' | 'ADMIN' | 'CRON';
  meta?: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// COMBINED READINESS
// ═══════════════════════════════════════════════════════════════

export interface CombinedReadiness {
  ready: boolean;
  btcStatus: LifecycleStatus | null;
  spxStatus: LifecycleStatus | null;
  blockers: string[];
  suggestedAction?: string;
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════

export interface LifecycleDiagnostics {
  modelId: ModelId;
  status: LifecycleStatus;
  systemMode: SystemMode;
  
  // Readiness checks
  applyEligible: boolean;
  applyBlockers: string[];
  
  // Metrics comparison
  historicalSharpe?: number;
  liveSharpe?: number;
  sharpeDeviation?: number;
  
  historicalHitRate?: number;
  liveHitRate?: number;
  hitRateDeviation?: number;
  
  // Governance
  constitutionHash: string | null;
  governanceLocked: boolean;
  
  // Drift
  driftSeverity: DriftSeverity;
  lastDriftCheck: string | null;
  
  // Samples
  liveSamples: number;
  requiredSamples: number;
  
  // Last operations
  lastDailyRun: string | null;
  lastCalibration: string | null;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export interface LifecycleConfig {
  systemMode: SystemMode;
  enableCombined: boolean;
  
  warmup: {
    targetDays: number;
    minSamples: number;
  };
  
  validation: {
    sharpeTolerance: number;
    hitRateTolerance: number;
    maxDDTolerance: number;
  };
  
  autoApply: {
    enabled: boolean;
    minSamples: number;
  };
  
  autoRevoke: {
    enabled: boolean;
    onCriticalDrift: boolean;
  };
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  systemMode: 'DEV',
  enableCombined: false,
  
  warmup: {
    targetDays: 30,
    minSamples: 30,
  },
  
  validation: {
    sharpeTolerance: 0.85,
    hitRateTolerance: 0.03,
    maxDDTolerance: 1.2,
  },
  
  autoApply: {
    enabled: true,
    minSamples: 30,
  },
  
  autoRevoke: {
    enabled: true,
    onCriticalDrift: true,
  },
};

// Default state factory
export function createDefaultState(modelId: ModelId): Partial<ModelLifecycleState> {
  return {
    modelId,
    engineVersion: 'v2.1',
    systemMode: 'DEV',
    status: 'SIMULATION',
    constitutionHash: null,
    governanceAppliedAt: null,
    warmup: {
      startedAt: null,
      targetDays: 30,
      resolvedDays: 0,
      progressPct: 0,
    },
    live: {
      liveSamples: 0,
      liveOutcomes: 0,
      lastLiveAsOfDate: null,
    },
    drift: {
      severity: 'OK',
      lastCheckedAt: null,
    },
  };
}

console.log('[Lifecycle] Types loaded (L1+L2)');
