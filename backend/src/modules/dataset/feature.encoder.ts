/**
 * PHASE 2.2 — Feature Encoder
 * ============================
 * 
 * Converts FeatureSnapshot into numeric features for ML.
 * 
 * ENCODING RULES (LOCKED v1):
 * - Verdict: BULLISH=1, NEUTRAL=0, BEARISH=-1
 * - WhaleRisk: LOW=0, MID=0.5, HIGH=1
 * - Alignment: ALIGNED=1, PARTIAL=0.5, CONFLICT=0
 * - Validation: CONFIRMS=1, NO_DATA=0.5, CONTRADICTS=0
 * - Readiness: READY=1, RISKY=0.5, AVOID/DEGRADED=0
 */

import { FeatureSnapshot } from '../features/featureSnapshot.types.js';
import { EncodedFeatures } from './dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// ENCODING MAPS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

const VERDICT_ENCODING: Record<string, number> = {
  'BULLISH': 1,
  'STRONG_BULLISH': 1,
  'WEAK_BULLISH': 0.5,
  'NEUTRAL': 0,
  'INCONCLUSIVE': 0,
  'WEAK_BEARISH': -0.5,
  'BEARISH': -1,
  'STRONG_BEARISH': -1,
  'NO_DATA': 0,
};

const WHALE_RISK_ENCODING: Record<string, number> = {
  'LOW': 0,
  'MID': 0.5,
  'HIGH': 1,
  'UNKNOWN': 0.5,
};

const ALIGNMENT_ENCODING: Record<string, number> = {
  'ALIGNED': 1,
  'PARTIAL': 0.5,
  'CONFLICT': 0,
  'NO_DATA': 0.5,
};

const VALIDATION_ENCODING: Record<string, number> = {
  'CONFIRMS': 1,
  'NO_DATA': 0.5,
  'CONTRADICTS': 0,
};

const READINESS_ENCODING: Record<string, number> = {
  'READY': 1,
  'RISKY': 0.5,
  'AVOID': 0,
  'DEGRADED': 0,
  'NO_DATA': 0.25,
};

// ═══════════════════════════════════════════════════════════════
// ENCODER
// ═══════════════════════════════════════════════════════════════

/**
 * Encode a FeatureSnapshot into numeric features for ML
 */
export function encodeFeatures(snapshot: FeatureSnapshot): EncodedFeatures {
  return {
    // Exchange features
    exchangeVerdict: VERDICT_ENCODING[snapshot.exchange.verdict] ?? 0,
    exchangeConfidence: snapshot.exchange.confidence,
    stress: snapshot.exchange.stress,
    whaleRisk: WHALE_RISK_ENCODING[snapshot.exchange.whaleRisk] ?? 0.5,
    readinessScore: READINESS_ENCODING[snapshot.exchange.readiness] ?? 0,

    // Sentiment features
    sentimentVerdict: VERDICT_ENCODING[snapshot.sentiment.verdict] ?? 0,
    sentimentConfidence: snapshot.sentiment.confidence,
    alignment: ALIGNMENT_ENCODING[snapshot.sentiment.alignment] ?? 0.5,

    // Onchain features
    onchainValidation: VALIDATION_ENCODING[snapshot.onchain.validation] ?? 0.5,
    onchainConfidence: snapshot.onchain.confidence,

    // Meta feature
    dataCompleteness: snapshot.meta.dataCompleteness,
  };
}

/**
 * Get feature names in order (for ML models)
 */
export function getFeatureNames(): string[] {
  return [
    'exchangeVerdict',
    'exchangeConfidence',
    'stress',
    'whaleRisk',
    'readinessScore',
    'sentimentVerdict',
    'sentimentConfidence',
    'alignment',
    'onchainValidation',
    'onchainConfidence',
    'dataCompleteness',
  ];
}

/**
 * Convert encoded features to flat array (for ML)
 */
export function featuresToArray(features: EncodedFeatures): number[] {
  return [
    features.exchangeVerdict,
    features.exchangeConfidence,
    features.stress,
    features.whaleRisk,
    features.readinessScore,
    features.sentimentVerdict,
    features.sentimentConfidence,
    features.alignment,
    features.onchainValidation,
    features.onchainConfidence,
    features.dataCompleteness,
  ];
}

console.log('[Phase 2.2] Feature Encoder loaded');
