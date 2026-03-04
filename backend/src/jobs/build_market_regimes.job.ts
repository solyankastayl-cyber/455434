/**
 * Build Market Regimes Job (Phase 14C.2)
 * 
 * Detects market regimes for assets with price data.
 */
import { DexPairModel, KNOWN_TOKENS } from '../core/market/dex_pairs.model.js';
import { detectRegime } from '../core/market_regimes/market_regime.service.js';
import { RegimeTimeframe } from '../core/market_regimes/market_regime.model.js';

let lastRunAt: Date | null = null;
let lastResult = {
  assetsProcessed: 0,
  regimesDetected: 0,
  regimeChanges: 0,
  errors: 0,
  duration: 0,
};

const TIMEFRAMES: RegimeTimeframe[] = ['1h', '4h'];

export async function buildMarketRegimes(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Get unique assets from pairs
  const pairs = await DexPairModel.find({ enabled: true });
  const assets = new Set<string>();
  
  const stablecoins = [
    KNOWN_TOKENS.ethereum?.USDC?.address.toLowerCase(),
    KNOWN_TOKENS.ethereum?.USDT?.address.toLowerCase(),
  ].filter(Boolean);
  
  for (const pair of pairs) {
    if (!stablecoins.includes(pair.token0.address.toLowerCase())) {
      assets.add(pair.token0.address.toLowerCase());
    }
    if (!stablecoins.includes(pair.token1.address.toLowerCase())) {
      assets.add(pair.token1.address.toLowerCase());
    }
  }
  
  let regimesDetected = 0;
  let regimeChanges = 0;
  let errors = 0;
  
  for (const assetAddress of assets) {
    for (const timeframe of TIMEFRAMES) {
      try {
        const regime = await detectRegime(assetAddress, 'ethereum', timeframe);
        if (regime) {
          regimesDetected++;
          if (regime.regimeChanged) {
            regimeChanges++;
          }
        }
      } catch (err) {
        errors++;
      }
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    assetsProcessed: assets.size,
    regimesDetected,
    regimeChanges,
    errors,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getBuildMarketRegimesStatus() {
  return { lastRunAt, lastResult };
}
