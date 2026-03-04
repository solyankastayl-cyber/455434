/**
 * Phase U: Performance Engine - Family Gating
 * 
 * Smart activation of detector families based on market context.
 * Skips irrelevant families to save compute.
 */

import { FeatureCache } from './feature_cache.js';

export type FamilyName =
  | 'STRUCTURE'
  | 'LEVELS'
  | 'BREAKOUTS'
  | 'TRIANGLES'
  | 'FLAGS'
  | 'REVERSALS'
  | 'HARMONICS'
  | 'ELLIOTT'
  | 'CANDLES'
  | 'DIVERGENCES'
  | 'MICROSTRUCTURE'
  | 'VOLUME'
  | 'MA_PATTERNS'
  | 'LIQUIDITY'
  | 'TREND_GEOMETRY';

export interface GatingContext {
  candleCount: number;
  pivotCount: number;
  regime?: string;
  volRegime?: string;
  hasVolume: boolean;
  volatility: number;
  trendStrength: number;
  cache: FeatureCache;
}

export interface GatingResult {
  shouldRun: boolean;
  reason?: string;
  priority: number;
}

/**
 * Determine if a detector family should run based on context
 */
export function shouldRunFamily(family: FamilyName, ctx: GatingContext): GatingResult {
  const { candleCount, pivotCount, regime, volRegime, hasVolume, volatility, trendStrength } = ctx;

  // Minimum data requirements
  const MIN_CANDLES: Record<FamilyName, number> = {
    STRUCTURE: 20,
    LEVELS: 15,
    BREAKOUTS: 20,
    TRIANGLES: 30,
    FLAGS: 25,
    REVERSALS: 40,
    HARMONICS: 50,
    ELLIOTT: 80,
    CANDLES: 5,
    DIVERGENCES: 30,
    MICROSTRUCTURE: 15,
    VOLUME: 10,
    MA_PATTERNS: 200,
    LIQUIDITY: 15,
    TREND_GEOMETRY: 25,
  };

  const MIN_PIVOTS: Record<FamilyName, number> = {
    STRUCTURE: 3,
    LEVELS: 2,
    BREAKOUTS: 2,
    TRIANGLES: 5,
    FLAGS: 4,
    REVERSALS: 5,
    HARMONICS: 5,
    ELLIOTT: 10,
    CANDLES: 0,
    DIVERGENCES: 4,
    MICROSTRUCTURE: 2,
    VOLUME: 0,
    MA_PATTERNS: 0,
    LIQUIDITY: 2,
    TREND_GEOMETRY: 4,
  };

  // Base priority (lower = run first)
  const BASE_PRIORITY: Record<FamilyName, number> = {
    STRUCTURE: 1,
    LEVELS: 2,
    CANDLES: 3,
    BREAKOUTS: 4,
    LIQUIDITY: 5,
    TRIANGLES: 6,
    FLAGS: 7,
    TREND_GEOMETRY: 8,
    REVERSALS: 9,
    DIVERGENCES: 10,
    MA_PATTERNS: 11,
    VOLUME: 12,
    HARMONICS: 13,
    MICROSTRUCTURE: 14,
    ELLIOTT: 15,
  };

  // Check minimum data
  if (candleCount < MIN_CANDLES[family]) {
    return { 
      shouldRun: false, 
      reason: `Insufficient candles: ${candleCount} < ${MIN_CANDLES[family]}`,
      priority: BASE_PRIORITY[family]
    };
  }

  if (pivotCount < MIN_PIVOTS[family]) {
    return { 
      shouldRun: false, 
      reason: `Insufficient pivots: ${pivotCount} < ${MIN_PIVOTS[family]}`,
      priority: BASE_PRIORITY[family]
    };
  }

  // Context-specific gating
  switch (family) {
    case 'VOLUME':
      if (!hasVolume) {
        return { shouldRun: false, reason: 'No volume data', priority: BASE_PRIORITY[family] };
      }
      break;

    case 'ELLIOTT':
      // Elliott waves need clear structure
      if (pivotCount < 10) {
        return { shouldRun: false, reason: 'Too few pivots for Elliott', priority: BASE_PRIORITY[family] };
      }
      break;

    case 'FLAGS':
    case 'BREAKOUTS':
      // Flags and breakouts less useful in extreme volatility range
      if (regime === 'RANGE' && volRegime === 'EXTREME') {
        return { 
          shouldRun: true, 
          reason: 'Lower priority in RANGE+EXTREME',
          priority: BASE_PRIORITY[family] + 5 // Deprioritize
        };
      }
      break;

    case 'HARMONICS':
      // Harmonics need reasonable volatility
      if (volatility < 0.05) {
        return { 
          shouldRun: true, 
          reason: 'Low volatility - harmonics less reliable',
          priority: BASE_PRIORITY[family] + 3
        };
      }
      break;

    case 'MA_PATTERNS':
      // MA patterns need 200 candles
      if (candleCount < 200) {
        return { shouldRun: false, reason: 'Need 200+ candles for MA patterns', priority: BASE_PRIORITY[family] };
      }
      break;
  }

  return { shouldRun: true, priority: BASE_PRIORITY[family] };
}

/**
 * Get all families that should run, sorted by priority
 */
export function getActiveFamilies(ctx: GatingContext): FamilyName[] {
  const families: FamilyName[] = [
    'STRUCTURE',
    'LEVELS',
    'BREAKOUTS',
    'TRIANGLES',
    'FLAGS',
    'REVERSALS',
    'HARMONICS',
    'ELLIOTT',
    'CANDLES',
    'DIVERGENCES',
    'MICROSTRUCTURE',
    'VOLUME',
    'MA_PATTERNS',
    'LIQUIDITY',
    'TREND_GEOMETRY',
  ];

  const active: Array<{ family: FamilyName; priority: number }> = [];

  for (const family of families) {
    const result = shouldRunFamily(family, ctx);
    if (result.shouldRun) {
      active.push({ family, priority: result.priority });
    }
  }

  // Sort by priority (lower first)
  active.sort((a, b) => a.priority - b.priority);

  return active.map(a => a.family);
}
