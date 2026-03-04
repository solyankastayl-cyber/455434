/**
 * BLOCK 38.3 — Confidence V2 Contracts
 * 
 * Two-layer confidence:
 * 1. Evidence confidence - from match quality (effectiveN, dispersion, consensus)
 * 2. System confidence - from reliability (drift, calibration, rolling, MC)
 * 
 * finalConfidence = calibratedEvidence * reliabilityModifier
 */

export interface ConfidenceV2Config {
  // Evidence scoring params
  n0: number;          // 8 - effectiveN scaling
  d0: number;          // 0.08 - dispersion scaling
  temp: number;        // 0.18 - sigmoid temperature
  
  // Calibration blending
  kBlend: number;      // 50 - blend weight for bucket calibration
  
  // Bucket settings
  enableRegimeBuckets: boolean;
  enableHorizonBuckets: boolean;
  
  // Evidence weights
  weights: {
    nScore: number;      // 0.45
    dispScore: number;   // 0.35
    consScore: number;   // 0.20
  };
}

export interface EvidenceBreakdown {
  effectiveN: number;
  dispersion: number;
  consensus: number;
  nScore: number;
  dispScore: number;
  consScore: number;
  rawEvidence: number;
  evidence: number;       // after sigmoid
}

export interface CalibrationBucket {
  range: string;          // "0.6-0.7"
  lo: number;
  hi: number;
  n: number;
  wins: number;
  pHit: number;           // wins/n (empirical)
  posterior: number;      // Beta posterior mean
}

export interface ConfidenceV2Result {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  evidence: EvidenceBreakdown;
  calibratedEvidence: number;
  reliability: number;
  reliabilityModifier: number;
  finalConfidence: number;
  bucket?: CalibrationBucket;
}

export const DEFAULT_CONFIDENCE_V2_CONFIG: ConfidenceV2Config = {
  n0: 8,
  d0: 0.08,
  temp: 0.18,
  kBlend: 50,
  enableRegimeBuckets: false,
  enableHorizonBuckets: true,
  weights: {
    nScore: 0.45,
    dispScore: 0.35,
    consScore: 0.20,
  },
};
