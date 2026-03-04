/**
 * BLOCK 63 — Adaptive Conflict Policy
 * 
 * Same conflict resolved differently based on regime.
 * CRISIS + conflict → HOLD (structure dominates)
 * NORMAL + conflict → COUNTER_TREND with penalty
 * LOW vol + conflict → Allow tactical entry
 */

import type { RegimeContext, VolatilityRegime } from '../regime/regime.types.js';
import type { ConflictResult } from '../strategy/resolver/conflict.policy.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AdaptiveConflictMode = 
  | 'TREND_FOLLOW' 
  | 'COUNTER_TREND' 
  | 'TACTICAL_ENTRY' 
  | 'WAIT' 
  | 'HOLD';

export interface AdaptiveConflictResult {
  baseMode: ConflictResult['mode'];
  effectiveMode: AdaptiveConflictMode;
  sizePenalty: number;          // 0-1, additional penalty
  confidencePenalty: number;    // 0-1, penalty on confidence
  structureOverride: boolean;   // Structure direction forced
  rationale: string[];
}

// ═══════════════════════════════════════════════════════════════
// POLICY TABLE
// ═══════════════════════════════════════════════════════════════

interface ConflictResolutionPolicy {
  effectiveMode: AdaptiveConflictMode;
  sizePenalty: number;
  confidencePenalty: number;
  structureOverride: boolean;
  rationale: string;
}

// [volRegime][conflictLevel] → resolution
const CONFLICT_RESOLUTION_TABLE: Record<VolatilityRegime, Record<string, ConflictResolutionPolicy>> = {
  LOW: {
    NONE: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0, confidencePenalty: 0, structureOverride: false, rationale: 'No conflict, trend follow' },
    MILD: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0.05, confidencePenalty: 0.02, structureOverride: false, rationale: 'Mild conflict, slight caution' },
    MODERATE: { effectiveMode: 'TACTICAL_ENTRY', sizePenalty: 0.15, confidencePenalty: 0.05, structureOverride: false, rationale: 'Allow tactical entry in low vol' },
    MAJOR: { effectiveMode: 'COUNTER_TREND', sizePenalty: 0.25, confidencePenalty: 0.08, structureOverride: false, rationale: 'Counter-trend with penalty' },
    SEVERE: { effectiveMode: 'WAIT', sizePenalty: 0.50, confidencePenalty: 0.15, structureOverride: false, rationale: 'Wait for clarity' },
  },
  NORMAL: {
    NONE: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0, confidencePenalty: 0, structureOverride: false, rationale: 'No conflict, trend follow' },
    MILD: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0.08, confidencePenalty: 0.03, structureOverride: false, rationale: 'Mild conflict, caution' },
    MODERATE: { effectiveMode: 'COUNTER_TREND', sizePenalty: 0.20, confidencePenalty: 0.07, structureOverride: false, rationale: 'Counter-trend mode' },
    MAJOR: { effectiveMode: 'COUNTER_TREND', sizePenalty: 0.35, confidencePenalty: 0.12, structureOverride: false, rationale: 'Major conflict, reduced exposure' },
    SEVERE: { effectiveMode: 'WAIT', sizePenalty: 0.60, confidencePenalty: 0.20, structureOverride: true, rationale: 'Severe conflict, wait' },
  },
  HIGH: {
    NONE: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0, confidencePenalty: 0, structureOverride: false, rationale: 'No conflict' },
    MILD: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0.12, confidencePenalty: 0.05, structureOverride: false, rationale: 'High vol + mild conflict' },
    MODERATE: { effectiveMode: 'COUNTER_TREND', sizePenalty: 0.30, confidencePenalty: 0.10, structureOverride: true, rationale: 'Structure bias dominates' },
    MAJOR: { effectiveMode: 'WAIT', sizePenalty: 0.50, confidencePenalty: 0.15, structureOverride: true, rationale: 'Wait for structure alignment' },
    SEVERE: { effectiveMode: 'HOLD', sizePenalty: 1.0, confidencePenalty: 0.30, structureOverride: true, rationale: 'Hold, no new trades' },
  },
  EXPANSION: {
    NONE: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0.05, confidencePenalty: 0.02, structureOverride: false, rationale: 'Vol expanding, cautious follow' },
    MILD: { effectiveMode: 'COUNTER_TREND', sizePenalty: 0.20, confidencePenalty: 0.08, structureOverride: true, rationale: 'Structure bias in expansion' },
    MODERATE: { effectiveMode: 'WAIT', sizePenalty: 0.40, confidencePenalty: 0.12, structureOverride: true, rationale: 'Wait in expansion' },
    MAJOR: { effectiveMode: 'HOLD', sizePenalty: 0.70, confidencePenalty: 0.20, structureOverride: true, rationale: 'Hold, vol expanding' },
    SEVERE: { effectiveMode: 'HOLD', sizePenalty: 1.0, confidencePenalty: 0.30, structureOverride: true, rationale: 'Full hold' },
  },
  CRISIS: {
    NONE: { effectiveMode: 'TREND_FOLLOW', sizePenalty: 0.15, confidencePenalty: 0.05, structureOverride: true, rationale: 'Crisis: structure follow only' },
    MILD: { effectiveMode: 'WAIT', sizePenalty: 0.40, confidencePenalty: 0.15, structureOverride: true, rationale: 'Crisis: wait for clarity' },
    MODERATE: { effectiveMode: 'HOLD', sizePenalty: 0.70, confidencePenalty: 0.25, structureOverride: true, rationale: 'Crisis: hold position' },
    MAJOR: { effectiveMode: 'HOLD', sizePenalty: 1.0, confidencePenalty: 0.35, structureOverride: true, rationale: 'Crisis: no new trades' },
    SEVERE: { effectiveMode: 'HOLD', sizePenalty: 1.0, confidencePenalty: 0.40, structureOverride: true, rationale: 'Crisis + severe conflict: full hold' },
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class AdaptiveConflictService {
  /**
   * Resolve conflict based on regime context.
   */
  resolveConflict(
    conflict: ConflictResult,
    context: RegimeContext
  ): AdaptiveConflictResult {
    const { volRegime, flags } = context;
    const conflictLevel = conflict.level;

    // Get policy from table
    const policy = CONFLICT_RESOLUTION_TABLE[volRegime]?.[conflictLevel] 
      || CONFLICT_RESOLUTION_TABLE['NORMAL'][conflictLevel]
      || CONFLICT_RESOLUTION_TABLE['NORMAL']['NONE'];

    // Build rationale
    const rationale: string[] = [policy.rationale];

    if (context.flags.noNewTrades) {
      rationale.push('No new trades flag active');
    }
    if (context.flags.structureDominates) {
      rationale.push('Structure dominates: long-term bias overrides');
    }

    // Override to HOLD if noNewTrades flag
    let effectiveMode = policy.effectiveMode;
    let sizePenalty = policy.sizePenalty;

    if (flags.noNewTrades && effectiveMode !== 'HOLD') {
      effectiveMode = 'HOLD';
      sizePenalty = 1.0;
      rationale.push('Overridden to HOLD due to no-new-trades flag');
    }

    return {
      baseMode: conflict.mode,
      effectiveMode,
      sizePenalty,
      confidencePenalty: policy.confidencePenalty,
      structureOverride: policy.structureOverride,
      rationale,
    };
  }

  /**
   * Get conflict level severity (0-1)
   */
  getConflictSeverity(level: string): number {
    const severityMap: Record<string, number> = {
      NONE: 0,
      MILD: 0.2,
      MODERATE: 0.5,
      MAJOR: 0.75,
      SEVERE: 1.0,
    };
    return severityMap[level] ?? 0.5;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: AdaptiveConflictService | null = null;

export function getAdaptiveConflictService(): AdaptiveConflictService {
  if (!_instance) {
    _instance = new AdaptiveConflictService();
  }
  return _instance;
}
