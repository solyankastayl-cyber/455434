/**
 * HORIZON META CONTRACT — Adaptive Similarity Weighting + Hierarchy
 * 
 * This module provides:
 * 1. Divergence Monitor: Tracks real vs predicted deviation
 * 2. Confidence Decay: Reduces confidence when forecasts diverge
 * 3. Horizon Hierarchy: Soft weighting (365D > 180D > 90D > 30D)
 * 4. Consensus Bias: Meta-level market verdict
 * 
 * CRITICAL: Does NOT change projections, only confidence/weight.
 * 
 * @module horizon-meta
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HorizonKey = 30 | 90 | 180 | 365;
export type HorizonBias = -1 | 0 | 1; // bearish | neutral | bullish

export type HorizonMetaMode = 'shadow' | 'on';
export type ConsensusState = 'BULLISH' | 'BEARISH' | 'HOLD';

// ═══════════════════════════════════════════════════════════════
// INPUT CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface HorizonMetaInput {
  /** Asset identifier: "dxy" | "spx" | "btc" */
  asset: string;
  
  /** As-of date for the forecast (ISO string) */
  asOf: string;
  
  /** Spot close price at asOf date */
  spotCloseAsOf: number;
  
  /** Predicted series by horizon (cumulative returns or closes) */
  predSeriesByHorizon: Partial<Record<HorizonKey, number[]>>;
  
  /** Type of series: "close" (absolute prices) or "cumReturn" (cumulative returns starting at 0) */
  predSeriesType: 'close' | 'cumReturn';
  
  /** Realized closes after asOf (K+1 values). Optional for live mode. */
  realizedClosesAfterAsOf?: number[];
  
  /** Base confidence per horizon (0..1) */
  baseConfidenceByHorizon: Partial<Record<HorizonKey, number>>;
  
  /** Stability score per horizon (0..1). Optional. */
  stabilityByHorizon?: Partial<Record<HorizonKey, number>>;
  
  /** Bias per horizon: -1 (bearish), 0 (neutral), +1 (bullish) */
  biasByHorizon: Partial<Record<HorizonKey, HorizonBias>>;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT: DIVERGENCE
// ═══════════════════════════════════════════════════════════════

export interface HorizonDivergence {
  /** Horizon in days */
  horizon: HorizonKey;
  
  /** Number of days in evaluation window */
  k: number;
  
  /** Mean absolute return error */
  div: number;
  
  /** Threshold for this horizon */
  thr: number;
  
  /** Excess ratio: (div - thr) / thr, if positive */
  excess: number;
  
  /** Decay factor: exp(-lambda * excess), clamped [0.35, 1.0] */
  decay: number;
  
  /** Adjusted confidence = baseConf * decay * stability */
  adjustedConfidence: number;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT: CONSENSUS
// ═══════════════════════════════════════════════════════════════

export interface HorizonConsensus {
  /** Base weights by horizon (sum = 1) */
  weightsBase: Record<HorizonKey, number>;
  
  /** Effective weights after decay/stability (sum = 1) */
  weightsEff: Record<HorizonKey, number>;
  
  /** Consensus bias: [-1, +1] */
  consensusBias: number;
  
  /** Consensus state: BULLISH / BEARISH / HOLD */
  consensusState: ConsensusState;
  
  /** Human-readable reasons */
  reasons: string[];
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT: FULL PACK
// ═══════════════════════════════════════════════════════════════

export interface HorizonMetaPack {
  /** Whether horizon meta is enabled */
  enabled: boolean;
  
  /** Mode: "shadow" (compute but don't apply) or "on" (apply to verdict) */
  mode: HorizonMetaMode;
  
  /** Divergence metrics per horizon (if realized data available) */
  divergences?: HorizonDivergence[];
  
  /** Consensus calculation */
  consensus?: HorizonConsensus;
  
  /** Processing timestamp */
  computedAt?: string;
}

// ═══════════════════════════════════════════════════════════════
// PROJECTION TRACKING (Live Overlay)
// ═══════════════════════════════════════════════════════════════

export interface ProjectionSnapshot {
  /** Asset identifier */
  asset: string;
  
  /** Horizon in days */
  horizon: HorizonKey;
  
  /** As-of date when projection was made */
  asOf: string;
  
  /** Projected series (cumulative returns) */
  series: number[];
  
  /** Confidence at time of projection */
  confidence: number;
  
  /** MD5 hash of inputs for deduplication */
  inputsHash: string;
  
  /** Timestamp when stored */
  storedAt: Date;
}

export interface ProjectionTrackingPack {
  /** Asset */
  asset: string;
  
  /** Horizon */
  horizon: HorizonKey;
  
  /** Current realized prices */
  realizedPrices: Array<{ date: string; close: number }>;
  
  /** Historical projections (faded overlays) */
  projections: Array<{
    asOf: string;
    series: number[];
    confidence: number;
    daysAgo: number;
  }>;
}
