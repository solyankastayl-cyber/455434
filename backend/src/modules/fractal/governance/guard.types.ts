/**
 * BLOCK 47 — Catastrophic Guard Types
 * Governance mode management + degeneration monitoring
 */

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE MODES
// ═══════════════════════════════════════════════════════════════

export type GovernanceMode =
  | 'NORMAL'
  | 'PROTECTION_MODE'
  | 'FROZEN_ONLY'
  | 'HALT_TRADING';

export type HealthLevel =
  | 'HEALTHY'
  | 'WATCH'
  | 'ALERT'
  | 'CRITICAL';

export type ReliabilityBadge =
  | 'OK'
  | 'WARN'
  | 'DEGRADED'
  | 'CRITICAL';

// ═══════════════════════════════════════════════════════════════
// REASON CODES (structured, not strings)
// ═══════════════════════════════════════════════════════════════

export type GuardReasonCode =
  | 'DRIFT_CRITICAL'
  | 'DRIFT_WARN'
  | 'CALIBRATION_CRITICAL'
  | 'CALIBRATION_DEGRADED'
  | 'TAIL_RISK_EXPANDED'
  | 'TAIL_RISK_SEVERE'
  | 'RELIABILITY_DROP_STREAK'
  | 'RELIABILITY_CRITICAL'
  | 'PERF_WINDOW_BREAKDOWN'
  | 'ENTROPY_INSTABILITY'
  | 'EFFECTIVE_N_COLLAPSE'
  | 'ANOMALY_CLUSTER'
  | 'HEALTH_CRITICAL'
  | 'HEALTH_ALERT_STREAK';

// ═══════════════════════════════════════════════════════════════
// DEGENERATION SUBSCORES
// ═══════════════════════════════════════════════════════════════

export interface DegenerationSubscores {
  reliabilityTrend: number;   // weight 0.25
  driftTrend: number;         // weight 0.20
  calibrationTrend: number;   // weight 0.15
  tailRiskTrend: number;      // weight 0.25
  perfWindowTrend: number;    // weight 0.15
}

export interface DegenerationResult {
  score: number;              // 0..1 aggregated
  subscores: DegenerationSubscores;
  reasons: GuardReasonCode[];
}

// ═══════════════════════════════════════════════════════════════
// GUARD DECISION
// ═══════════════════════════════════════════════════════════════

export interface GuardDecision {
  recommendedMode: GovernanceMode;
  currentMode: GovernanceMode;
  reasons: GuardReasonCode[];
  degenerationScore: number;
  catastrophicTriggered: boolean;
  latchUntil: number | null;         // timestamp if latched
  confidence: number;                 // 0..1 confidence in recommendation
  timestamp: number;
  wouldChange: boolean;               // true if mode would change
}

// ═══════════════════════════════════════════════════════════════
// GUARD CONTEXT (inputs from BLOCK 45/46)
// ═══════════════════════════════════════════════════════════════

export interface GuardContext {
  symbol: string;
  asOf?: number;
  
  // Current governance state
  governanceMode: GovernanceMode;
  latchUntil: number | null;
  
  // Health (from telemetry)
  health: HealthLevel;
  healthStreak: number;              // consecutive days in current health
  
  // Reliability
  reliability: {
    score: number;
    badge: ReliabilityBadge;
    delta7d: number;                 // change over 7 days
  };
  
  // Drift
  drift: {
    score: number;
    badge: ReliabilityBadge;
  };
  
  // Calibration
  calibration: {
    badge: ReliabilityBadge;
    ece: number;
    brier: number;
    eceDelta30d: number;
  };
  
  // Monte Carlo tail risk
  tailRisk: {
    p95MaxDD: number;
    worstDD: number;
    medianDD: number;
    p95Delta30d: number;             // widening indicator
  };
  
  // Performance windows
  perfWindows: {
    sharpe30d: number;
    sharpe60d: number;
    maxDD60d: number;
    hitRate30d: number;
  };
  
  // Entropy
  entropy: {
    ema: number;
    dominance: number;
    minScaleTriggeredCount: number;
  };
  
  // Effective N
  effectiveN: {
    current: number;
    delta7d: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// LATCH CONFIGURATION
// ═══════════════════════════════════════════════════════════════

export interface LatchConfig {
  protectionMinDays: number;         // default 14
  frozenMinDays: number;             // default 30
  exitRequiredHealthyDays: number;   // default 7
}

export const DEFAULT_LATCH_CONFIG: LatchConfig = {
  protectionMinDays: 14,
  frozenMinDays: 30,
  exitRequiredHealthyDays: 7,
};

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export interface GuardThresholds {
  // Critical triggers (immediate)
  driftCritical: number;
  p95MaxDDCritical: number;
  worstDDCritical: number;
  
  // Alert triggers
  driftWarn: number;
  p95MaxDDWarn: number;
  reliabilityDrop7dWarn: number;
  sharpe60dWarn: number;
  maxDD60dWarn: number;
  
  // Degeneration thresholds
  degenerationFrozen: number;
  degenerationProtection: number;
}

export const DEFAULT_GUARD_THRESHOLDS: GuardThresholds = {
  // Critical
  driftCritical: 0.4,
  p95MaxDDCritical: 0.55,
  worstDDCritical: 0.75,
  
  // Alert
  driftWarn: 0.25,
  p95MaxDDWarn: 0.45,
  reliabilityDrop7dWarn: -0.12,
  sharpe60dWarn: 0,
  maxDD60dWarn: 0.18,
  
  // Degeneration
  degenerationFrozen: 0.75,
  degenerationProtection: 0.55,
};

// ═══════════════════════════════════════════════════════════════
// GUARD STATE (persisted)
// ═══════════════════════════════════════════════════════════════

export interface GuardState {
  mode: GovernanceMode;
  latchUntil: number | null;
  lastDecision: GuardDecision | null;
  lastUpdated: number;
  updatedBy: 'SYSTEM' | 'ADMIN';
}

// ═══════════════════════════════════════════════════════════════
// API TYPES
// ═══════════════════════════════════════════════════════════════

export interface GuardCheckRequest {
  symbol: string;
  asOf?: number;
  apply?: boolean;                   // default false
  allowAutoProtection?: boolean;     // default false
}

export interface GuardCheckResponse {
  ok: boolean;
  decision: GuardDecision;
  applied: boolean;
  state: GuardState;
}

export interface GuardOverrideRequest {
  mode: GovernanceMode;
  reason: string;
  actor: string;
}

export interface GuardHistoryEntry {
  ts: number;
  decision: GuardDecision;
  applied: boolean;
  actor: 'SYSTEM' | 'ADMIN';
  reason?: string;
}
