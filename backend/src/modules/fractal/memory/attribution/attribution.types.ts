/**
 * BLOCK 75.UI.1 — Attribution Types
 * 
 * Type definitions for Attribution Tab API responses.
 * "Desk-grade" — все метрики имеют sample count и confidence bounds.
 */

import type { TierType, FocusHorizon, GradeType } from '../snapshot/prediction-snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// REQUEST PARAMS
// ═══════════════════════════════════════════════════════════════

export interface AttributionQueryParams {
  symbol: 'BTC';
  window: '30d' | '90d' | '180d' | '365d';
  preset: 'conservative' | 'balanced' | 'aggressive';
  role: 'ACTIVE' | 'SHADOW';
}

// ═══════════════════════════════════════════════════════════════
// RESPONSE TYPES
// ═══════════════════════════════════════════════════════════════

export interface AttributionMeta {
  symbol: string;
  windowDays: number;
  asof: string;
  preset: string;
  role: string;
  sampleCount: number;
  resolvedCount: number;
}

export interface AttributionHeadline {
  hitRate: number;
  hitRateCI: [number, number] | null;  // 95% Wilson confidence interval
  expectancy: number;
  expectancyCI: [number, number] | null;
  sharpe: number | null;              // null if N < minSamples
  maxDD: number;
  calibrationError: number;           // |avgExpected - avgRealized|
  avgDivergenceScore: number;
  scaledVsRawDelta: number;           // positive = scaling helped
}

export interface TierStats {
  tier: TierType;
  samples: number;
  hitRate: number;
  hitRateCI: [number, number] | null;
  expectancy: number;
  sharpe: number | null;
  maxDD: number;
  grade: GradeType;
  gradeCapped: boolean;               // true if N < minSamples
  notes: string[];
}

export interface RegimeStats {
  regime: string;                      // LOW/NORMAL/HIGH/EXPANSION/CRISIS
  samples: number;
  hitRate: number;
  expectancy: number;
  maxDD: number;
  avgVolMult: number;
  grade: GradeType;
}

export interface DivergenceStats {
  grade: GradeType;
  samples: number;
  hitRate: number;
  expectancy: number;
  avgScore: number;
}

export interface PhaseStats {
  phaseType: string;
  samples: number;
  score73: number;                     // phase quality score
  grade: GradeType;
  sizeMult: number;
  hitRate: number;
  expectancy: number;
}

export interface InsightItem {
  id: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
  evidence: string;                    // data backing the insight
}

export interface GuardrailsStatus {
  minSamplesByTier: Record<TierType, number>;
  capsApplied: string[];               // list of caps applied
  insufficientData: boolean;
  reasons: string[];
}

export interface AttributionResponse {
  meta: AttributionMeta;
  headline: AttributionHeadline;
  tiers: TierStats[];
  regimes: RegimeStats[];
  divergence: DivergenceStats[];
  phases: PhaseStats[];
  insights: InsightItem[];
  guardrails: GuardrailsStatus;
}

// ═══════════════════════════════════════════════════════════════
// GOVERNANCE TYPES (for UI Tab)
// ═══════════════════════════════════════════════════════════════

export interface GovernanceResponse {
  currentPolicy: {
    version: string;
    tierWeights: Record<TierType, number>;
    horizonWeights: Record<FocusHorizon, number>;
    regimeMultipliers: Record<string, { structureBoost: number; timingPenalty: number }>;
    divergencePenalties: Record<GradeType, number>;
    phaseGradeMultipliers: Record<GradeType, number>;
    updatedAt: string;
  };
  proposedChanges: {
    version: string;
    diffs: Array<{
      field: string;
      oldValue: number;
      newValue: number;
      changePercent: number;
      reason: string;
    }>;
    proposedAt: string;
  } | null;
  driftStats: {
    structuralWeightDrift: number;
    timingWeightDrift: number;
    tacticalWeightDrift: number;
  };
  guardrails: {
    minSamplesOk: boolean;
    driftWithinLimit: boolean;
    notInCrisis: boolean;
    canApply: boolean;
    reasons: string[];
  };
  auditLog: Array<{
    id: string;
    action: 'DRY_RUN' | 'PROPOSE' | 'APPLY' | 'REJECT';
    timestamp: string;
    actor: string;
    summary: string;
  }>;
}
