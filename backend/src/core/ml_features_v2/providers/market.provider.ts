/**
 * Market Feature Provider (P0.6)
 * 
 * Connected to P1.5 - CEX Layer.
 * Extracts market context features from market_data module.
 */

import {
  ProviderContext,
  ProviderResult,
  MarketFeatureKey,
  FeatureValue
} from '../types/feature.types.js';

// Import from P1.5 market_data module
import { 
  getLatestMetric 
} from '../../market_data/storage/market_metric.model.js';
import { 
  getQuality 
} from '../../market_data/storage/market_quality.model.js';

// ============================================
// Types
// ============================================

export type MarketFeatures = Partial<Record<MarketFeatureKey, FeatureValue>>;

// ============================================
// Market Provider (P1.5 Connected)
// ============================================

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
    
    // Get 24h metrics (fallback to 7d if not available)
    let metric24h = await getLatestMetric(primarySymbol, '24h');
    if (!metric24h) {
      metric24h = await getLatestMetric(primarySymbol, '7d');
    }
    
    if (!metric24h) {
      // No market data available
      return {
        features: createNullMarketFeatures(),
        source: 'MARKET',
        timestamp: new Date(),
        errors: ['No market data available - run sync first'],
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
      const penalty = Math.min(0.5, quality.freshnessLagMin / 120);
      
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
      features: createNullMarketFeatures(),
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

function normalizeZscore(z: number | undefined): number {
  if (z === undefined || z === null) return 0.5;
  // Clamp to -3..+3, then scale to 0..1
  const clamped = Math.max(-3, Math.min(3, z));
  return (clamped + 3) / 6;
}

function regimeToNumber(regime: string | undefined): number {
  if (!regime) return 0.5;
  switch (regime) {
    case 'CALM': return 0;
    case 'VOLATILE': return 0.5;
    case 'STRESSED': return 1;
    default: return 0.5;
  }
}

function calculateLiquidityScore(volumeTotal: number, volumeMean: number): number {
  // Simple liquidity score based on volume consistency
  if (!volumeTotal || !volumeMean) return 0.5;
  
  // Higher volume = better liquidity
  const logVolume = Math.log10(volumeTotal + 1);
  const normalized = Math.min(1, logVolume / 12); // log10(1T) ≈ 12
  
  return normalized;
}

function normalizePriceChange(pct: number | undefined): number {
  if (pct === undefined || pct === null) return 0.5;
  // Clamp to -50..+50, then scale to 0..1
  const clamped = Math.max(-50, Math.min(50, pct));
  return (clamped + 50) / 100;
}

function normalizeVolume(volume: number): number {
  if (!volume || volume <= 0) return 0;
  // Log normalize, scale to 0..1
  const logVol = Math.log10(volume + 1);
  return Math.min(1, logVol / 12);
}

function createNullMarketFeatures(): MarketFeatures {
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
