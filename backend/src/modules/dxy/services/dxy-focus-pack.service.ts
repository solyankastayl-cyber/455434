/**
 * DXY FOCUS PACK SERVICE — Main Fractal Aggregator
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { getAllDxyCandles, getDxyLatestPrice } from './dxy-chart.service.js';
import { scanDxyFractals } from './dxy-scan.service.js';
import { buildReplayPacks, aggregateReplayPaths, calculateExpectedReturn } from './dxy-replay.service.js';
import { horizonToDays, isValidDxyHorizon, type DxyHorizon, type DxyFocusPack } from '../contracts/dxy.types.js';

// ═══════════════════════════════════════════════════════════════
// BUILD FOCUS PACK
// ═══════════════════════════════════════════════════════════════

export async function buildDxyFocusPack(horizon: string): Promise<DxyFocusPack | null> {
  // Validate horizon
  if (!isValidDxyHorizon(horizon)) {
    throw new Error(`Invalid horizon: ${horizon}. Valid: 7d, 14d, 30d, 90d, 180d, 365d`);
  }
  
  const horizonDays = horizonToDays(horizon as DxyHorizon);
  
  // Get all candles
  const candles = await getAllDxyCandles();
  
  if (candles.length < 500) {
    throw new Error(`Insufficient DXY data: ${candles.length} candles (need 500+)`);
  }
  
  // Get current price
  const latest = await getDxyLatestPrice();
  const currentPrice = latest?.price || candles[candles.length - 1].close;
  
  // Scan for matches
  const scanResult = scanDxyFractals(candles);
  
  if (scanResult.matches.length === 0) {
    // Return minimal pack with no matches
    return {
      horizon,
      matches: [],
      replay: [],
      path: [],
      bands: { p10: [], p50: [], p90: [] },
      diagnostics: {
        similarity: 0,
        entropy: 1,
        coverageYears: candles.length / 252,
        matchCount: 0,
      },
    };
  }
  
  // Build replay packs
  const replayPacks = buildReplayPacks(candles, scanResult.matches, horizonDays);
  
  // Aggregate paths
  const aggregated = aggregateReplayPaths(replayPacks, currentPrice);
  
  return {
    horizon,
    matches: scanResult.matches,
    replay: replayPacks,
    path: aggregated.path,
    bands: aggregated.bands,
    diagnostics: {
      similarity: scanResult.diagnostics.avgSimilarity,
      entropy: scanResult.diagnostics.entropy,
      coverageYears: Math.round(candles.length / 252 * 10) / 10,
      matchCount: scanResult.matches.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD SYNTHETIC (MODEL-BASED) PACK
// ═══════════════════════════════════════════════════════════════

export async function buildDxySyntheticPack(horizon: string): Promise<{
  horizon: string;
  forecast: {
    bear: number;
    base: number;
    bull: number;
  };
  currentPrice: number;
  path: number[];
  bands: {
    p10: number[];
    p50: number[];
    p90: number[];
  };
}> {
  const focusPack = await buildDxyFocusPack(horizon);
  
  if (!focusPack || focusPack.replay.length === 0) {
    // Return default values
    const latest = await getDxyLatestPrice();
    const currentPrice = latest?.price || 100;
    
    return {
      horizon,
      forecast: { bear: -0.02, base: 0, bull: 0.02 },
      currentPrice,
      path: [],
      bands: { p10: [], p50: [], p90: [] },
    };
  }
  
  const expectedReturn = calculateExpectedReturn(focusPack.replay);
  const latest = await getDxyLatestPrice();
  
  return {
    horizon,
    forecast: expectedReturn,
    currentPrice: latest?.price || 100,
    path: focusPack.path,
    bands: focusPack.bands,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD HYBRID PACK (weighted average of model + replay)
// ═══════════════════════════════════════════════════════════════

export async function buildDxyHybridPack(
  horizon: string,
  hybridWeight = 0.5 // 0 = pure model, 1 = pure replay
): Promise<{
  horizon: string;
  hybridWeight: number;
  forecast: {
    bear: number;
    base: number;
    bull: number;
  };
  path: number[];
  bands: {
    p10: number[];
    p50: number[];
    p90: number[];
  };
}> {
  const synthetic = await buildDxySyntheticPack(horizon);
  const focusPack = await buildDxyFocusPack(horizon);
  
  if (!focusPack || focusPack.replay.length === 0) {
    return {
      horizon,
      hybridWeight: 0,
      forecast: synthetic.forecast,
      path: synthetic.path,
      bands: synthetic.bands,
    };
  }
  
  const replayReturn = calculateExpectedReturn(focusPack.replay);
  
  // Weighted blend
  const blend = (synth: number, replay: number) => 
    synth * (1 - hybridWeight) + replay * hybridWeight;
  
  return {
    horizon,
    hybridWeight,
    forecast: {
      bear: blend(synthetic.forecast.bear, replayReturn.bear),
      base: blend(synthetic.forecast.base, replayReturn.base),
      bull: blend(synthetic.forecast.bull, replayReturn.bull),
    },
    path: focusPack.path,
    bands: focusPack.bands,
  };
}
