/**
 * Build Price Points Job (Phase 14A.1)
 * 
 * Fetches prices from DEX pairs every 60-120 seconds.
 */
import { DexPairModel } from '../core/market/dex_pairs.model.js';
import { fetchAndStorePairPrice, getWethPriceUsd, initializeDexPairs } from '../core/market/price.service.js';

let lastRunAt: Date | null = null;
let lastResult = {
  pairsProcessed: 0,
  pricesStored: 0,
  errors: 0,
  wethPriceUsd: 0,
  duration: 0,
};

let initialized = false;

export async function buildPricePoints(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Initialize pairs on first run
  if (!initialized) {
    const created = await initializeDexPairs();
    if (created > 0) {
      console.log(`[Build Prices] Initialized ${created} DEX pairs`);
    }
    initialized = true;
  }
  
  // Get enabled pairs, prioritize anchor pairs first
  const pairs = await DexPairModel.find({ enabled: true })
    .sort({ isAnchorPair: -1, liquidityHint: -1 })
    .limit(50);
  
  let pricesStored = 0;
  let errors = 0;
  let wethPriceUsd = 0;
  
  // First pass: process anchor pairs to get WETH price
  for (const pair of pairs) {
    if (!pair.isAnchorPair) continue;
    
    try {
      const pricePoint = await fetchAndStorePairPrice(pair);
      if (pricePoint) {
        pricesStored++;
        // Get WETH price from anchor
        wethPriceUsd = await getWethPriceUsd() || 0;
      }
    } catch (err) {
      console.error(`[Build Prices] Anchor pair ${pair.pairAddress} failed:`, err);
      errors++;
    }
  }
  
  // Second pass: process token pairs using WETH price
  if (wethPriceUsd > 0) {
    for (const pair of pairs) {
      if (pair.isAnchorPair) continue;
      
      try {
        const pricePoint = await fetchAndStorePairPrice(pair, wethPriceUsd);
        if (pricePoint) {
          pricesStored++;
        }
      } catch (err) {
        console.error(`[Build Prices] Pair ${pair.pairAddress} failed:`, err);
        errors++;
      }
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    pairsProcessed: pairs.length,
    pricesStored,
    errors,
    wethPriceUsd,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getBuildPricePointsStatus() {
  return {
    lastRunAt,
    lastResult,
    initialized,
  };
}
