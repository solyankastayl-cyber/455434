/**
 * Market Features Provider (P1.5)
 * 
 * Extracts ML features from market data.
 * These are CONTEXT features, not signals.
 * 
 * Replaces the stub in P0.6.
 */

import {
  ProviderContext,
  ProviderResult,
  MarketFeatureKey,
  FeatureValue
} from '../../ml_features_v2/types/feature.types.js';
import { getLatestMetric } from '../storage/market_metric.model.js';
import { getQuality } from '../storage/market_quality.model.js';

// ============================================
// Types
// ============================================

export type MarketFeatures = Partial<Record<MarketFeatureKey, FeatureValue>>;

// ============================================
// Market Features Provider
// ============================================

/**
 * Extract market features for ML
 */
export async function extractMarketFeatures(
  ctx: ProviderContext,
  relatedSymbols?: string[]
): Promise<ProviderResult<MarketFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: MarketFeatures = {};
  
  try {
    // Determine relevant symbols
    // For WALLET/ACTOR, we look at ETH as default context
    // For TOKEN, we'd look at the specific token
    const primarySymbol = relatedSymbols?.[0] || 'ETH';
    
    // Get 24h metrics
    const metric24h = await getLatestMetric(primarySymbol, '24h');
    
    if (!metric24h) {
      // No market data available
      return {
        features: createPartialMarketFeatures(null),
        source: 'MARKET',
        timestamp: new Date(),
        errors: ['No market data available'],
        durationMs: Date.now() - startTime
      };
    }
    
    // Get quality info
    const quality = await getQuality(primarySymbol, '1h');
    
    // Extract features with normalization
    
    // Volume delta z-score (clamped -3 to +3, normalized to 0-1)
    features.market_volumeDeltaZscore = normalizeZscore(metric24h.volumeZ);
    
    // Volatility regime (0 = CALM, 0.5 = VOLATILE, 1 = STRESSED)
    features.market_volatilityRegime = regimeToNumber(metric24h.regime);
    
    // Liquidity regime (based on volume quality)
    // Higher volume = better liquidity proxy
    features.market_liquidityRegime = calculateLiquidityScore(
      metric24h.volumeTotal,
      metric24h.volumeMean
    );
    
    // Price change 24h (normalized -1 to +1)
    features.market_priceChangePercent24h = normalizePriceChange(metric24h.priceChangePct);
    
    // Volume USD 24h (log normalized)
    features.market_volumeUsd24h = normalizeVolume(metric24h.volumeTotal);
    
    // Data quality score (0-1)
    features.market_dataQuality = quality 
      ? Math.min(1, quality.qualityScore / 100)
      : 0;
    
    // Is stressed regime (binary)
    features.market_isStressed = metric24h.regime === 'STRESSED';
    
    // Apply freshness penalty if data is stale
    if (quality && quality.freshnessLagMin > 30) {
      // Reduce confidence in market features if data is stale
      const penalty = Math.min(0.5, quality.freshnessLagMin / 120); // Max 50% penalty
      
      // Apply penalty (move features toward neutral)
      for (const key of Object.keys(features) as MarketFeatureKey[]) {
        const value = features[key];
        if (typeof value === 'number') {
          features[key] = value * (1 - penalty);
        }
      }
    }
    
  } catch (err) {
    errors.push(`Market provider error: ${(err as Error).message}`);
    return {
      features: createPartialMarketFeatures(null),
      source: 'MARKET',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'MARKET',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Normalization Functions
// ============================================

/**
 * Normalize z-score to [0, 1] range
 * -3 -> 0, 0 -> 0.5, +3 -> 1
 */
function normalizeZscore(z: number): number {
  const clamped = Math.max(-3, Math.min(3, z));
  return Math.round(((clamped + 3) / 6) * 1000) / 1000;
}

/**
 * Convert regime to numeric value
 */
function regimeToNumber(regime: string): number {
  switch (regime) {
    case 'CALM':
      return 0;
    case 'VOLATILE':
      return 0.5;
    case 'STRESSED':
      return 1;
    default:
      return 0.25; // Unknown
  }
}

/**
 * Calculate liquidity score (0-1)
 */
function calculateLiquidityScore(volumeTotal: number, volumeMean: number): number {
  if (volumeTotal <= 0 || volumeMean <= 0) return 0;
  
  // Higher volume = better liquidity
  // Log scale to handle wide range
  const logVolume = Math.log10(volumeTotal + 1);
  
  // Normalize: $1M = 0.5, $100M = 0.8, $1B = 1.0
  // log10(1M) = 6, log10(100M) = 8, log10(1B) = 9
  const normalized = Math.min(1, Math.max(0, (logVolume - 4) / 5));
  
  return Math.round(normalized * 1000) / 1000;
}

/**
 * Normalize price change to [-1, +1]
 * -20% or worse -> -1
 * +20% or more -> +1
 */
function normalizePriceChange(pct: number): number {
  const clamped = Math.max(-20, Math.min(20, pct));
  return Math.round((clamped / 20) * 1000) / 1000;
}

/**
 * Normalize volume with log scale to [0, 1]
 */
function normalizeVolume(volume: number): number {
  if (volume <= 0) return 0;
  
  // Log normalize: $100K = 0.2, $1M = 0.4, $10M = 0.6, $100M = 0.8, $1B = 1.0
  const logVolume = Math.log10(volume + 1);
  const normalized = Math.min(1, Math.max(0, logVolume / 9));
  
  return Math.round(normalized * 1000) / 1000;
}

// ============================================
// Helpers
// ============================================

function createPartialMarketFeatures(metric: null): MarketFeatures {
  return {
    market_volumeDeltaZscore: null,
    market_volatilityRegime: null,
    market_liquidityRegime: null,
    market_priceChangePercent24h: null,
    market_volumeUsd24h: null,
    market_dataQuality: null,
    market_isStressed: null
  };
}

/**
 * Get feature count for market
 */
export function getMarketFeatureCount(): number {
  return 7;
}
