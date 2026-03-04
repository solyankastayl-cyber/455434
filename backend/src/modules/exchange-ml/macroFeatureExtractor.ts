/**
 * Macro Feature Extractor for ML
 * 
 * Extracts normalized macro context features for ML training.
 * All features are discretized/bucketed - NO raw values.
 * 
 * RULES:
 * - NO raw percentages
 * - NO float values from CoinGecko
 * - ONLY normalized/discretized features
 * - Macro is CONTEXT, not PREDICTOR
 */

import { MacroContextFeatures } from './ml.types.js';
import { 
  MacroContext,
  MarketRegimeId,
  RiskLevelId,
  MACRO_INTEL_THRESHOLDS 
} from '../macro-intel/contracts/macro-intel.types.js';
import { getMacroIntelContext } from '../macro-intel/services/macro-intel.snapshot.service.js';

// ═══════════════════════════════════════════════════════════════
// FEAR & GREED BUCKETING
// ═══════════════════════════════════════════════════════════════

type FearGreedBucket = 0 | 1 | 2 | 3 | 4;

function bucketFearGreed(value: number): FearGreedBucket {
  if (value <= MACRO_INTEL_THRESHOLDS.EXTREME_FEAR_THRESHOLD) return 0; // EXTREME_FEAR
  if (value <= MACRO_INTEL_THRESHOLDS.FEAR_THRESHOLD) return 1;         // FEAR
  if (value <= MACRO_INTEL_THRESHOLDS.GREED_THRESHOLD) return 2;        // NEUTRAL
  if (value <= MACRO_INTEL_THRESHOLDS.EXTREME_GREED_THRESHOLD) return 3; // GREED
  return 4; // EXTREME_GREED
}

// ═══════════════════════════════════════════════════════════════
// CAPITAL FLOW BIAS CALCULATION
// ═══════════════════════════════════════════════════════════════

type CapitalFlowBias = -1 | 0 | 1;

function calculateCapitalFlowBias(
  btcDomTrend: number,
  stableDomTrend: number
): CapitalFlowBias {
  // Capital outflow: stables rising, BTC dom rising (panic)
  if (stableDomTrend === 1 && btcDomTrend === 1) return -1;
  
  // Capital inflow: stables falling, BTC dom falling (risk-on to alts)
  if (stableDomTrend === -1 && btcDomTrend === -1) return 1;
  
  // Neutral
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// MAIN EXTRACTION FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract macro features from MacroContext
 */
export function extractMacroFeatures(context: MacroContext): MacroContextFeatures {
  return {
    macroRegimeId: context.regimeId,
    macroRiskLevel: context.riskLevelId,
    fearGreedBucket: bucketFearGreed(context.fearGreed),
    btcDomTrend: context.btcDominanceTrend,
    stableDomTrend: context.stableDominanceTrend,
    capitalFlowBias: calculateCapitalFlowBias(
      context.btcDominanceTrend,
      context.stableDominanceTrend
    ),
  };
}

/**
 * Get current macro features for real-time inference
 */
export async function getCurrentMacroFeatures(): Promise<MacroContextFeatures | null> {
  try {
    const context = await getMacroIntelContext();
    return extractMacroFeatures(context);
  } catch (error) {
    console.warn('[MacroFeatureExtractor] Failed to get macro context:', error);
    return null;
  }
}

/**
 * Convert macro features to vector for ML model
 */
export function macroFeaturesToVector(features: MacroContextFeatures): number[] {
  return [
    features.macroRegimeId,      // 0-7
    features.macroRiskLevel,     // 0-3
    features.fearGreedBucket,    // 0-4
    features.btcDomTrend,        // -1, 0, 1
    features.stableDomTrend,     // -1, 0, 1
    features.capitalFlowBias,    // -1, 0, 1
  ];
}

export const MACRO_FEATURE_NAMES = [
  'macroRegimeId',
  'macroRiskLevel',
  'fearGreedBucket',
  'btcDomTrend',
  'stableDomTrend',
  'capitalFlowBias',
];

// ═══════════════════════════════════════════════════════════════
// DEFAULT VALUES (for rows without macro data)
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_MACRO_FEATURES: MacroContextFeatures = {
  macroRegimeId: 0,
  macroRiskLevel: 1,      // MEDIUM
  fearGreedBucket: 2,      // NEUTRAL
  btcDomTrend: 0,          // FLAT
  stableDomTrend: 0,       // FLAT
  capitalFlowBias: 0,      // NEUTRAL
};

/**
 * Check if macro features look valid (not all defaults)
 */
export function isMacroDataValid(features: MacroContextFeatures): boolean {
  // If everything is exactly default, data might be missing
  const isAllDefault = (
    features.macroRegimeId === DEFAULT_MACRO_FEATURES.macroRegimeId &&
    features.macroRiskLevel === DEFAULT_MACRO_FEATURES.macroRiskLevel &&
    features.fearGreedBucket === DEFAULT_MACRO_FEATURES.fearGreedBucket &&
    features.btcDomTrend === DEFAULT_MACRO_FEATURES.btcDomTrend &&
    features.stableDomTrend === DEFAULT_MACRO_FEATURES.stableDomTrend
  );
  
  return !isAllDefault;
}

console.log('[MacroFeatureExtractor] Loaded');
