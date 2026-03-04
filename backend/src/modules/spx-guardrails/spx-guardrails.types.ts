/**
 * SPX GUARDRAILS — Types
 * 
 * BLOCK B6.7 — Institutional Anti-Harm Guardrails
 * 
 * Prevents model from generating harmful signals in low-edge regimes.
 */

export type GuardrailStatus = 'ALLOW' | 'CAUTION' | 'BLOCK';

export type ReasonCode = 
  | 'NEG_SKILL'           // skill <= -1pp
  | 'LOW_SAMPLE'          // samples < minSamples
  | 'HIGH_DIVERGENCE'     // historical divergence is high
  | 'TAIL_RISK'           // p10 very negative
  | 'UNSTABLE_EDGE'       // edge only in one decade
  | 'EDGE_NOT_CONFIRMED_GLOBAL' // 90d is only confirmed edge
  | 'DECADE_HARMFUL'      // decade has negative skill
  | 'SHORT_DISABLED';     // DOWN direction blocked

export interface GuardrailCaps {
  maxSizeMult: number;           // 0..1.25, caps position size
  maxConfidence: number;         // 0..1, caps confidence
  allowedDirections: ('UP' | 'DOWN')[];  // which directions allowed
}

export interface GuardrailEvidence {
  skill: number;                 // edge vs baseline
  hitRate: number;               // raw hit rate
  baselineRate: number;          // baseline for comparison
  samples: number;               // total samples
  decade?: string;               // which decade
  expectancy?: number;           // expected return
  sharpe?: number;               // sharpe ratio
  maxDD?: number;                // max drawdown
}

export interface GuardrailDecision {
  horizon: string;               // "7d"..."365d"
  status: GuardrailStatus;
  reasons: ReasonCode[];
  caps: GuardrailCaps;
  evidence: GuardrailEvidence;
}

export interface GuardrailPolicy {
  version: string;
  policyHash: string;
  computedAt: string;
  preset: string;
  globalStatus: GuardrailStatus;
  allowedHorizons: string[];
  blockedHorizons: string[];
  cautionHorizons: string[];
  decisions: GuardrailDecision[];
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (Institutional Defaults)
// ═══════════════════════════════════════════════════════════════

export const GUARDRAIL_THRESHOLDS = {
  MIN_SAMPLES: 24,               // minimum samples per cell
  EDGE_STRONG: 0.015,            // +1.5pp = strong edge
  EDGE_WEAK: 0.005,              // +0.5pp = weak edge  
  HARM_THRESHOLD: -0.01,         // -1pp = model is harmful
  CAUTION_ABS: 0.015,            // ±1.5pp = caution zone
  
  // Size caps by status
  BLOCK_SIZE_MULT: 0,            // no trade
  CAUTION_SIZE_MULT: 0.85,       // reduced size
  ALLOW_SIZE_MULT: 1.0,          // full size
  
  // Confidence caps by status
  BLOCK_CONFIDENCE: 0.4,
  CAUTION_CONFIDENCE: 0.6,
  ALLOW_CONFIDENCE: 1.0,
};

// Constitutional rule: which horizons have confirmed edge
export const CONFIRMED_EDGE_HORIZONS = ['90d']; // From B6.6 analysis
