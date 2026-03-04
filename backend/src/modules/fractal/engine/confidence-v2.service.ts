/**
 * BLOCK 38.3 — Confidence V2 Service
 * 
 * Two-layer confidence computation:
 * 1. Evidence confidence from match quality
 * 2. System confidence from reliability
 */

import {
  ConfidenceV2Config,
  EvidenceBreakdown,
  ConfidenceV2Result,
  DEFAULT_CONFIDENCE_V2_CONFIG,
} from '../contracts/confidence-v2.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

// ═══════════════════════════════════════════════════════════════
// Evidence Confidence
// ═══════════════════════════════════════════════════════════════

/**
 * Compute evidence confidence from match quality metrics
 * 
 * @param effectiveN - effective sample size (after weighting)
 * @param dispersion - weighted std of forward returns
 * @param consensus - fraction of weight supporting the signal direction
 * @param cfg - configuration
 */
export function computeEvidenceConfidence(
  effectiveN: number,
  dispersion: number,
  consensus: number,
  cfg: ConfidenceV2Config = DEFAULT_CONFIDENCE_V2_CONFIG
): EvidenceBreakdown {
  // N score: saturates around n0
  const nScore = 1 - Math.exp(-effectiveN / cfg.n0);
  
  // Dispersion score: lower is better
  const dispScore = Math.exp(-dispersion / cfg.d0);
  
  // Consensus score: how aligned are the matches
  const consScore = clamp01((consensus - 0.5) / 0.5);
  
  // Raw evidence (weighted sum)
  const rawEvidence = 
    cfg.weights.nScore * nScore +
    cfg.weights.dispScore * dispScore +
    cfg.weights.consScore * consScore;
  
  // Temperature-scaled sigmoid to prevent over-confidence
  const evidence = sigmoid((rawEvidence - 0.5) / cfg.temp);
  
  return {
    effectiveN,
    dispersion,
    consensus,
    nScore: Math.round(nScore * 1000) / 1000,
    dispScore: Math.round(dispScore * 1000) / 1000,
    consScore: Math.round(consScore * 1000) / 1000,
    rawEvidence: Math.round(rawEvidence * 1000) / 1000,
    evidence: clamp01(Math.round(evidence * 1000) / 1000),
  };
}

// ═══════════════════════════════════════════════════════════════
// Reliability Modifier (step function)
// ═══════════════════════════════════════════════════════════════

/**
 * Convert reliability score to confidence modifier
 * Uses step function with "shelves" for stability
 */
export function reliabilityModifier(reliability: number): number {
  if (reliability >= 0.85) return 1.00;
  if (reliability >= 0.70) return 0.85;
  if (reliability >= 0.55) return 0.65;
  if (reliability >= 0.40) return 0.45;
  return 0.25;
}

/**
 * Convert reliability score to modifier (smooth version)
 */
export function reliabilityModifierSmooth(reliability: number): number {
  // Smooth curve: 0.4 + 0.6 * r
  return 0.4 + 0.6 * clamp01(reliability);
}

// ═══════════════════════════════════════════════════════════════
// Bucket Calibration (Beta-Binomial blend)
// ═══════════════════════════════════════════════════════════════

interface BucketData {
  n: number;
  wins: number;
  priorA?: number;
  priorB?: number;
}

/**
 * Compute posterior mean from Beta-Binomial
 */
export function posteriorMean(wins: number, n: number, priorA = 2, priorB = 2): number {
  return (wins + priorA) / (n + priorA + priorB);
}

/**
 * Blend evidence with bucket empirical data
 * 
 * @param evidence - raw evidence confidence
 * @param bucket - bucket statistics (if available)
 * @param kBlend - blending constant (higher = more trust in bucket)
 */
export function blendWithBucket(
  evidence: number,
  bucket: BucketData | null,
  kBlend = 50
): number {
  if (!bucket || bucket.n === 0) {
    return evidence;
  }
  
  const pHit = posteriorMean(bucket.wins, bucket.n, bucket.priorA, bucket.priorB);
  const alpha = bucket.n / (bucket.n + kBlend);
  
  return (1 - alpha) * evidence + alpha * pHit;
}

// ═══════════════════════════════════════════════════════════════
// Full Confidence Pipeline
// ═══════════════════════════════════════════════════════════════

export interface ConfidenceV2Input {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  effectiveN: number;
  dispersion: number;
  consensus: number;
  reliability: number;
  bucket?: BucketData | null;
}

/**
 * Compute full confidence (evidence + calibration + reliability)
 */
export function computeConfidenceV2(
  input: ConfidenceV2Input,
  cfg: ConfidenceV2Config = DEFAULT_CONFIDENCE_V2_CONFIG
): ConfidenceV2Result {
  // 1. Evidence confidence
  const evidence = computeEvidenceConfidence(
    input.effectiveN,
    input.dispersion,
    input.consensus,
    cfg
  );
  
  // 2. Calibrate with bucket (if available)
  const calibratedEvidence = blendWithBucket(
    evidence.evidence,
    input.bucket ?? null,
    cfg.kBlend
  );
  
  // 3. Apply reliability modifier
  const relMod = reliabilityModifier(input.reliability);
  
  // 4. Final confidence
  const finalConfidence = clamp01(calibratedEvidence * relMod);
  
  return {
    signal: input.signal,
    evidence,
    calibratedEvidence: Math.round(calibratedEvidence * 1000) / 1000,
    reliability: Math.round(input.reliability * 1000) / 1000,
    reliabilityModifier: relMod,
    finalConfidence: Math.round(finalConfidence * 1000) / 1000,
    bucket: input.bucket ? {
      range: `${Math.floor(evidence.evidence * 10) / 10}-${Math.ceil(evidence.evidence * 10) / 10}`,
      lo: Math.floor(evidence.evidence * 10) / 10,
      hi: Math.ceil(evidence.evidence * 10) / 10,
      n: input.bucket.n,
      wins: input.bucket.wins,
      pHit: input.bucket.n > 0 ? input.bucket.wins / input.bucket.n : 0,
      posterior: posteriorMean(input.bucket.wins, input.bucket.n),
    } : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// Consensus Calculation
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate consensus from weighted matches
 * Consensus = fraction of total weight supporting the majority direction
 */
export function calculateConsensus(
  matches: Array<{ mu: number; weight: number }>
): { consensus: number; direction: 'LONG' | 'SHORT' | 'NEUTRAL' } {
  if (matches.length === 0) {
    return { consensus: 0.5, direction: 'NEUTRAL' };
  }
  
  let longWeight = 0;
  let shortWeight = 0;
  let totalWeight = 0;
  
  for (const m of matches) {
    totalWeight += m.weight;
    if (m.mu > 0) {
      longWeight += m.weight;
    } else if (m.mu < 0) {
      shortWeight += m.weight;
    }
  }
  
  if (totalWeight === 0) {
    return { consensus: 0.5, direction: 'NEUTRAL' };
  }
  
  const longPct = longWeight / totalWeight;
  const shortPct = shortWeight / totalWeight;
  
  if (longPct > shortPct) {
    return { consensus: longPct, direction: 'LONG' };
  } else if (shortPct > longPct) {
    return { consensus: shortPct, direction: 'SHORT' };
  }
  
  return { consensus: 0.5, direction: 'NEUTRAL' };
}
