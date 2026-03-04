/**
 * BLOCK 2.4 — Funding Feature Builder
 * =====================================
 * Funding as full Exchange-level feature for BTC and each alt.
 */

import { fundingService } from '../../../exchange/funding/funding.service.js';
import type { FundingContext } from '../../../exchange/funding/contracts/funding.context.js';

export interface FundingFeatures {
  fundingRate: number;        // current rate (% per period)
  fundingZ: number;           // z-score vs history
  fundingTrend: number;       // slope over N hours
  fundingAbs: number;         // |funding|
  fundingCrowdedness: number; // 0..1 (how crowded)
  fundingSqueezeBias: 'UP' | 'DOWN' | 'NEUTRAL';
  fundingDispersion: number;  // venue disagreement
}

const SQUEEZE_THRESHOLD = 0.5;  // fundingScore threshold for squeeze bias

/**
 * Build funding features for a symbol
 */
export async function buildFundingFeatures(symbol: string): Promise<FundingFeatures> {
  try {
    const ctx = await fundingService.getContextOne(symbol);
    
    if (!ctx) {
      return getDefaultFundingFeatures();
    }

    return contextToFeatures(ctx);
  } catch (e) {
    console.warn(`[FundingFeatures] Error for ${symbol}:`, e);
    return getDefaultFundingFeatures();
  }
}

/**
 * Build funding features from existing context
 */
export function contextToFeatures(ctx: FundingContext): FundingFeatures {
  const fundingRate = ctx.fundingScore;
  const fundingZ = ctx.fundingScore * 100;  // Normalized to z-score scale
  const fundingTrend = ctx.fundingTrend;
  const fundingAbs = Math.abs(ctx.fundingScore);
  
  // Crowdedness: 0..1 based on z-score
  const fundingCrowdedness = clamp01(Math.abs(ctx.fundingScore) / 1.5);
  
  // Squeeze bias
  let fundingSqueezeBias: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
  if (ctx.fundingScore >= SQUEEZE_THRESHOLD) {
    fundingSqueezeBias = 'DOWN';  // Crowd long → squeeze down
  } else if (ctx.fundingScore <= -SQUEEZE_THRESHOLD) {
    fundingSqueezeBias = 'UP';    // Crowd short → squeeze up
  }
  
  return {
    fundingRate,
    fundingZ,
    fundingTrend,
    fundingAbs,
    fundingCrowdedness,
    fundingSqueezeBias,
    fundingDispersion: ctx.fundingDispersion,
  };
}

/**
 * Get default funding features (when data unavailable)
 */
function getDefaultFundingFeatures(): FundingFeatures {
  return {
    fundingRate: 0,
    fundingZ: 0,
    fundingTrend: 0,
    fundingAbs: 0,
    fundingCrowdedness: 0,
    fundingSqueezeBias: 'NEUTRAL',
    fundingDispersion: 0,
  };
}

/**
 * Funding gate for cluster propagation
 */
export function fundingGate(clusterType: string, fundingBias: 'UP' | 'DOWN' | 'NEUTRAL'): number {
  if (clusterType === 'MOMENTUM') {
    if (fundingBias === 'DOWN') return 0.65;  // Crowd long → dangerous to continue
    return 1.0;
  }

  if (clusterType === 'MEAN_REVERSION') {
    return 1.0;  // Funding not critical for mean reversion
  }

  if (clusterType === 'FUNDING_SQUEEZE') {
    return 1.15;  // Boost if all conditions align
  }

  return 1.0;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

console.log('[Alts] Funding Feature Builder loaded');
