/**
 * BLOCK 49 — Admin Overview Contract
 * Single payload for institutional dashboard
 */

// ═══════════════════════════════════════════════════════════════
// META
// ═══════════════════════════════════════════════════════════════

export interface AdminOverviewMeta {
  symbol: string;
  asOf: string;
  version: string;
  contract: {
    horizonsDays: number[];
  };
}

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE
// ═══════════════════════════════════════════════════════════════

export type GovernanceMode = 'NORMAL' | 'PROTECTION_MODE' | 'FROZEN_ONLY' | 'HALT_TRADING';

export interface AdminOverviewGovernance {
  mode: GovernanceMode;
  protectionMode: boolean;
  frozenOnly: boolean;
  activePreset: string;
  freeze: {
    isFrozen: boolean;
    frozenAt: string | null;
    reason: string | null;
  };
  guardrails: {
    valid: boolean;
    violations: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH
// ═══════════════════════════════════════════════════════════════

export type HealthState = 'HEALTHY' | 'WATCH' | 'ALERT' | 'CRITICAL';
export type Severity = 'OK' | 'WARN' | 'ALERT' | 'CRITICAL';

export interface TopRisk {
  key: string;
  severity: Severity;
  value: number;
  threshold: number;
}

export interface AdminOverviewHealth {
  state: HealthState;
  score: number;
  headline: string;
  topRisks: TopRisk[];
}

// ═══════════════════════════════════════════════════════════════
// GUARD
// ═══════════════════════════════════════════════════════════════

export interface GuardSubscores {
  reliability: number;
  drift: number;
  calibration: number;
  tailRisk: number;
  performance: number;
}

export interface GuardEvent {
  ts: string;
  type: string;
  detail: string;
}

export interface AdminOverviewGuard {
  state: Severity;
  degenerationScore: number;
  subscores: GuardSubscores;
  latch: {
    active: boolean;
    until: string | null;
    windowDays: number;
  };
  lastEvents: GuardEvent[];
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════════════════════

export interface TelemetryAnomaly {
  type: string;
  severity: Severity;
  ts: string;
}

export interface AdminOverviewTelemetry {
  health: HealthState;
  anomalies: TelemetryAnomaly[];
  lastCheck: string;
}

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export type ReliabilityBadge = 'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL';

export interface ReliabilityBreakdown {
  drift: number;
  calibration: number;
  rolling: number;
  mcTail: number;
}

export interface AdminOverviewReliability {
  score: number;
  badge: ReliabilityBadge;
  policy: string;
  modifier: number;
  breakdown: ReliabilityBreakdown;
}

export interface AdminOverviewCalibration {
  ece: number;
  brier: number;
  badge: ReliabilityBadge;
  updatedAt: string;
}

export interface AdminOverviewMC {
  method: string;
  p95MaxDD: number;
  p05CAGR: number;
  p10Sharpe: number;
  updatedAt: string;
}

export interface AdminOverviewModel {
  reliability: AdminOverviewReliability;
  calibration: AdminOverviewCalibration;
  mc: AdminOverviewMC;
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface PerformanceWindow {
  sharpe: number;
  maxDD: number;
  hitRate: number;
}

export interface AdminOverviewPerformance {
  windows: {
    d30: PerformanceWindow;
    d60: PerformanceWindow;
    d90: PerformanceWindow;
  };
}

// ═══════════════════════════════════════════════════════════════
// RECOMMENDATION
// ═══════════════════════════════════════════════════════════════

export type PlaybookType = 
  | 'NO_ACTION'
  | 'INVESTIGATION' 
  | 'PROTECTION_ESCALATION' 
  | 'RECALIBRATION'
  | 'RECOVERY'
  | 'FREEZE_ONLY';

export interface SuggestedAction {
  action: string;
  endpoint: string;
}

export interface AdminOverviewRecommendation {
  playbook: PlaybookType;
  priority: number;
  reasonCodes: string[];
  suggestedActions: SuggestedAction[];
  requiresConfirm: boolean;
}

// ═══════════════════════════════════════════════════════════════
// RECENT
// ═══════════════════════════════════════════════════════════════

export interface RecentSnapshot {
  date: string;
  reliability: number;
  health: HealthState;
}

export interface AuditEntry {
  ts: string;
  actor: string;
  action: string;
  note: string;
}

export interface AdminOverviewRecent {
  snapshots: RecentSnapshot[];
  audit: AuditEntry[];
}

// ═══════════════════════════════════════════════════════════════
// FULL RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface AdminOverviewResponse {
  meta: AdminOverviewMeta;
  governance: AdminOverviewGovernance;
  health: AdminOverviewHealth;
  guard: AdminOverviewGuard;
  telemetry: AdminOverviewTelemetry;
  model: AdminOverviewModel;
  performance: AdminOverviewPerformance;
  recommendation: AdminOverviewRecommendation;
  recent: AdminOverviewRecent;
}
