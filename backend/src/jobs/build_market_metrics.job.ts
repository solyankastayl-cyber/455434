/**
 * Build Market Metrics Job (Phase 14A.2)
 * 
 * Calculates aggregated market metrics every 5-10 minutes.
 */
import { DexPairModel, KNOWN_TOKENS } from '../core/market/dex_pairs.model.js';
import { calculateMarketMetrics } from '../core/market/market_metrics.service.js';
import { MetricsWindow } from '../core/market/market_metrics.model.js';

let lastRunAt: Date | null = null;
let lastResult = {
  assetsProcessed: 0,
  metricsCalculated: 0,
  errors: 0,
  duration: 0,
};

const WINDOWS: MetricsWindow[] = ['1h', '24h'];

export async function buildMarketMetrics(): Promise<typeof lastResult> {
  const start = Date.now();
  
  // Get unique assets from pairs
  const pairs = await DexPairModel.find({ enabled: true });
  const assets = new Set<string>();
  
  for (const pair of pairs) {
    // Skip stablecoins for metrics
    const usdcAddress = KNOWN_TOKENS.ethereum.USDC?.address.toLowerCase();
    const usdtAddress = KNOWN_TOKENS.ethereum.USDT?.address.toLowerCase();
    
    if (pair.token0.address.toLowerCase() !== usdcAddress && 
        pair.token0.address.toLowerCase() !== usdtAddress) {
      assets.add(pair.token0.address.toLowerCase());
    }
    if (pair.token1.address.toLowerCase() !== usdcAddress && 
        pair.token1.address.toLowerCase() !== usdtAddress) {
      assets.add(pair.token1.address.toLowerCase());
    }
  }
  
  let metricsCalculated = 0;
  let errors = 0;
  
  for (const assetAddress of assets) {
    for (const window of WINDOWS) {
      try {
        const metrics = await calculateMarketMetrics(assetAddress, 'ethereum', window);
        if (metrics) {
          metricsCalculated++;
        }
      } catch (err) {
        console.error(`[Build Metrics] ${assetAddress} ${window} failed:`, err);
        errors++;
      }
    }
  }
  
  lastRunAt = new Date();
  lastResult = {
    assetsProcessed: assets.size,
    metricsCalculated,
    errors,
    duration: Date.now() - start,
  };
  
  return lastResult;
}

export function getBuildMarketMetricsStatus() {
  return {
    lastRunAt,
    lastResult,
  };
}
