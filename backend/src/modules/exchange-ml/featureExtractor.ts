/**
 * S10.7.1 — Feature Extractor
 * 
 * Converts raw ExchangeObservationRow into normalized MLFeatures.
 * All features scaled to 0..1 or -1..1 for ML compatibility.
 * 
 * NO interpretation, NO thresholds, NO logic — just transformation.
 */

import { MLFeatures } from './ml.types.js';
import { ExchangeObservationRow } from '../exchange/observation/observation.types.js';

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

export function extractFeatures(row: ExchangeObservationRow): MLFeatures {
  // Regime features
  const regimeConfidence = row.regime?.confidence || 0;
  const regimeType = row.regime?.type || 'NEUTRAL';
  const regimeIsExpansion = regimeType === 'EXPANSION' ? 1 : 0;
  const regimeIsSqueeze = (regimeType === 'LONG_SQUEEZE' || regimeType === 'SHORT_SQUEEZE') ? 1 : 0;
  const regimeIsExhaustion = regimeType === 'EXHAUSTION' ? 1 : 0;
  
  // Order Flow features
  const flowBias = normalizeFlowBias(row.orderFlow?.aggressorBias, row.orderFlow?.dominance);
  const flowDominance = row.orderFlow?.dominance || 0.5;
  const absorptionStrength = row.orderFlow?.absorption ? 
    Math.min(1, Math.abs(row.orderFlow.imbalance || 0)) : 0;
  const imbalancePressure = clamp(row.orderFlow?.imbalance || 0, -1, 1);
  
  // Volume features
  const volumeRatio = normalizeVolumeRatio(row.volume?.ratio || 1);
  const volumeDelta = normalizePercentage(row.volume?.delta || 0, 50); // ±50% range
  
  // OI features
  const oiDelta = normalizePercentage(row.openInterest?.deltaPct || 0, 20); // ±20% range
  const oiVolumeDivergence = calculateDivergence(
    row.openInterest?.deltaPct || 0,
    row.volume?.delta || 0
  );
  
  // Liquidation features
  const cascadeActive = row.liquidations?.cascadeActive ? 1 : 0;
  const liquidationIntensity = normalizeLiquidationIntensity(
    row.liquidations?.longVolume || 0,
    row.liquidations?.shortVolume || 0
  );
  
  // Pattern features
  const totalPatterns = row.patternCount || 0;
  const patternCount = Math.min(totalPatterns / 5, 1); // Normalize to 0..1 (5+ = max)
  const conflictCount = row.hasConflict ? 
    Math.min(row.bullishPatterns || 0, row.bearishPatterns || 0) : 0;
  const bullishRatio = totalPatterns > 0 ? 
    (row.bullishPatterns || 0) / totalPatterns : 0;
  const bearishRatio = totalPatterns > 0 ? 
    (row.bearishPatterns || 0) / totalPatterns : 0;
  
  // Derived composite features
  const marketStress = calculateMarketStress({
    cascadeActive,
    liquidationIntensity,
    regimeIsSqueeze,
    imbalancePressure,
    conflictCount,
  });
  
  const readability = calculateReadability({
    regimeConfidence,
    conflictCount,
    volumeRatio,
    absorptionStrength,
    regimeIsExpansion,
  });
  
  return {
    // Regime
    regimeConfidence,
    regimeIsExpansion,
    regimeIsSqueeze,
    regimeIsExhaustion,
    
    // Order Flow
    flowBias,
    flowDominance,
    absorptionStrength,
    imbalancePressure,
    
    // Volume
    volumeRatio,
    volumeDelta,
    
    // OI
    oiDelta,
    oiVolumeDivergence,
    
    // Liquidation
    cascadeActive,
    liquidationIntensity,
    
    // Patterns
    patternCount,
    conflictCount,
    bullishRatio,
    bearishRatio,
    
    // Derived
    marketStress,
    readability,
  };
}

// ═══════════════════════════════════════════════════════════════
// FEATURE VECTOR (for ML models)
// ═══════════════════════════════════════════════════════════════

export function featuresToVector(features: MLFeatures): number[] {
  return [
    features.regimeConfidence,
    features.regimeIsExpansion,
    features.regimeIsSqueeze,
    features.regimeIsExhaustion,
    features.flowBias,
    features.flowDominance,
    features.absorptionStrength,
    features.imbalancePressure,
    features.volumeRatio,
    features.volumeDelta,
    features.oiDelta,
    features.oiVolumeDivergence,
    features.cascadeActive,
    features.liquidationIntensity,
    features.patternCount,
    features.conflictCount,
    features.bullishRatio,
    features.bearishRatio,
    features.marketStress,
    features.readability,
  ];
}

export const FEATURE_NAMES = [
  'regimeConfidence',
  'regimeIsExpansion',
  'regimeIsSqueeze',
  'regimeIsExhaustion',
  'flowBias',
  'flowDominance',
  'absorptionStrength',
  'imbalancePressure',
  'volumeRatio',
  'volumeDelta',
  'oiDelta',
  'oiVolumeDivergence',
  'cascadeActive',
  'liquidationIntensity',
  'patternCount',
  'conflictCount',
  'bullishRatio',
  'bearishRatio',
  'marketStress',
  'readability',
];

// Combined feature names including macro (for macro-aware training)
export const FEATURE_NAMES_WITH_MACRO = [
  ...FEATURE_NAMES,
  'macroRegimeId',
  'macroRiskLevel',
  'fearGreedBucket',
  'btcDomTrend',
  'stableDomTrend',
  'capitalFlowBias',
];

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeFlowBias(
  bias: 'BUY' | 'SELL' | 'NEUTRAL' | undefined,
  dominance: number = 0.5
): number {
  if (!bias || bias === 'NEUTRAL') return 0;
  const strength = (dominance - 0.5) * 2; // 0..1 to 0..1
  return bias === 'BUY' ? strength : -strength;
}

function normalizeVolumeRatio(ratio: number): number {
  // 0.5x to 3x range normalized to 0..1
  return clamp((ratio - 0.5) / 2.5, 0, 1);
}

function normalizePercentage(pct: number, maxRange: number): number {
  // ±maxRange% to -1..1
  return clamp(pct / maxRange, -1, 1);
}

function normalizeLiquidationIntensity(longVol: number, shortVol: number): number {
  const total = longVol + shortVol;
  // Assuming $500K is "high intensity"
  return clamp(total / 500000, 0, 1);
}

function calculateDivergence(oiPct: number, volumePct: number): number {
  // Divergence = how much they move in opposite directions
  // Same direction = 0, opposite = 1
  if (Math.sign(oiPct) === Math.sign(volumePct)) return 0;
  const divergenceStrength = Math.abs(oiPct - volumePct) / 30; // 30% diff = max
  return clamp(divergenceStrength, 0, 1);
}

function calculateMarketStress(params: {
  cascadeActive: number;
  liquidationIntensity: number;
  regimeIsSqueeze: number;
  imbalancePressure: number;
  conflictCount: number;
}): number {
  const {
    cascadeActive,
    liquidationIntensity,
    regimeIsSqueeze,
    imbalancePressure,
    conflictCount,
  } = params;
  
  // Weighted combination
  const stress = (
    cascadeActive * 0.35 +
    liquidationIntensity * 0.25 +
    regimeIsSqueeze * 0.2 +
    Math.abs(imbalancePressure) * 0.1 +
    Math.min(conflictCount / 3, 1) * 0.1
  );
  
  return clamp(stress, 0, 1);
}

function calculateReadability(params: {
  regimeConfidence: number;
  conflictCount: number;
  volumeRatio: number;
  absorptionStrength: number;
  regimeIsExpansion: number;
}): number {
  const {
    regimeConfidence,
    conflictCount,
    volumeRatio,
    absorptionStrength,
    regimeIsExpansion,
  } = params;
  
  // High confidence + expansion + absorption + normal volume = readable
  // Conflicts decrease readability
  const conflictPenalty = Math.min(conflictCount * 0.3, 0.6);
  const volumeBonus = volumeRatio > 0.3 && volumeRatio < 0.8 ? 0.1 : 0;
  
  const readability = (
    regimeConfidence * 0.4 +
    regimeIsExpansion * 0.2 +
    absorptionStrength * 0.15 +
    volumeBonus -
    conflictPenalty
  );
  
  return clamp(readability, 0, 1);
}

console.log('[S10.7] Feature Extractor loaded');
