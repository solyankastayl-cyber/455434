/**
 * BLOCK 48.1 — Playbook Types
 * Structured decision recommendations
 */

import { GovernanceMode, HealthLevel, ReliabilityBadge, GuardReasonCode } from '../guard.types.js';

// ═══════════════════════════════════════════════════════════════
// PLAYBOOK TYPES
// ═══════════════════════════════════════════════════════════════

export type PlaybookType =
  | 'FREEZE_ONLY'
  | 'PROTECTION_ESCALATION'
  | 'RECALIBRATION'
  | 'INVESTIGATION'
  | 'RECOVERY'
  | 'NO_ACTION';

export type PlaybookSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

// ═══════════════════════════════════════════════════════════════
// PLAYBOOK ACTIONS (structured, not strings)
// ═══════════════════════════════════════════════════════════════

export type PlaybookActionType =
  | 'SET_MODE'
  | 'RAISE_CONFIDENCE_THRESHOLD'
  | 'RAISE_RELIABILITY_THRESHOLD'
  | 'LIMIT_EXPOSURE'
  | 'ENABLE_PROTECTION'
  | 'RESET_CALIBRATION'
  | 'FREEZE_VERSION'
  | 'RUN_VALIDATION'
  | 'RUN_MONTE_CARLO'
  | 'COMPARE_SHADOW'
  | 'NO_ACTION';

export interface PlaybookAction {
  type: PlaybookActionType;
  payload?: Record<string, unknown>;
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// PLAYBOOK DECISION
// ═══════════════════════════════════════════════════════════════

export interface PlaybookDecision {
  type: PlaybookType;
  severity: PlaybookSeverity;
  rationale: string[];
  recommendedActions: PlaybookAction[];
  risks: string[];
  alternatives: string[];
  requiresConfirmation: boolean;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// PLAYBOOK CONTEXT (all inputs)
// ═══════════════════════════════════════════════════════════════

export interface PlaybookContext {
  symbol: string;
  
  // From Guard (BLOCK 47)
  governanceMode: GovernanceMode;
  degenerationScore: number;
  catastrophicTriggered: boolean;
  guardReasons: GuardReasonCode[];
  
  // Health
  health: HealthLevel;
  healthStreak: number;
  healthWatchDays: number;           // days in WATCH state
  
  // Reliability
  reliability: {
    score: number;
    badge: ReliabilityBadge;
    delta7d: number;
  };
  
  // Calibration
  calibration: {
    badge: ReliabilityBadge;
    ece: number;
  };
  
  // Tail Risk
  tailRisk: {
    p95MaxDD: number;
    worstDD: number;
  };
  
  // Performance
  perfWindows: {
    sharpe60d: number;
    maxDD60d: number;
  };
  
  // Drift
  drift: {
    score: number;
    badge: ReliabilityBadge;
  };
  
  // Consecutive healthy days (for recovery)
  consecutiveHealthyDays: number;
}

// ═══════════════════════════════════════════════════════════════
// APPLY REQUEST/RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface PlaybookApplyRequest {
  type: PlaybookType;
  confirm: boolean;
  actor: string;
  reason?: string;
}

export interface PlaybookApplyResult {
  ok: boolean;
  applied: boolean;
  appliedMode?: GovernanceMode;
  actionsExecuted: string[];
  message: string;
  auditRef?: string;
}

// ═══════════════════════════════════════════════════════════════
// HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════

export interface PlaybookHistoryEntry {
  ts: number;
  type: PlaybookType;
  severity: PlaybookSeverity;
  applied: boolean;
  actor: string;
  reason?: string;
  appliedMode?: GovernanceMode;
}
