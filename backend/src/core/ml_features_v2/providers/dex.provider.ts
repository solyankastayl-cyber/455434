/**
 * DEX Feature Provider (P0.6)
 * 
 * Extracts ML features from DEX Layer (P0.4).
 */

import {
  ProviderContext,
  ProviderResult,
  DexFeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { DexTradeModel, IDexTrade } from '../../dex_layer/storage/dex_trade.model.js';

// ============================================
// Types
// ============================================

export type DexFeatures = Partial<Record<DexFeatureKey, FeatureValue>>;

// Stablecoin addresses (lowercase)
const STABLECOINS = new Set([
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on ETH
  '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT on ETH
  '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI on ETH
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', // USDC.e on ARB
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT on ARB
  '0x7f5c764cbc14f9669b88837ca1490cca17c31607', // USDC on OP
  '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca', // USDbC on BASE
]);

// ============================================
// DEX Provider
// ============================================

export async function extractDexFeatures(
  ctx: ProviderContext
): Promise<ProviderResult<DexFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: DexFeatures = {};
  
  try {
    // Query trades for this wallet in time window
    const windowStartTs = Math.floor(ctx.windowStart.getTime() / 1000);
    const windowEndTs = Math.floor(ctx.windowEnd.getTime() / 1000);
    
    const trades = await DexTradeModel.find({
      trader: ctx.entityId.toLowerCase(),
      timestamp: {
        $gte: windowStartTs,
        $lte: windowEndTs
      }
    })
    .sort({ timestamp: -1 })
    .limit(1000)
    .lean();
    
    if (trades.length === 0) {
      return {
        features: createNullDexFeatures(),
        source: 'DEX',
        timestamp: new Date(),
        errors: [],
        durationMs: Date.now() - startTime
      };
    }
    
    // Calculate features
    const aggregated = aggregateDexFeatures(trades, windowStartTs, windowEndTs);
    
    // Map to feature keys
    features.dex_activityScore = aggregated.activityScore;
    features.dex_swapBeforeExit = aggregated.hasSwapBeforeExit;
    features.dex_swapCount24h = aggregated.swapCount24h;
    features.dex_swapCountTotal = aggregated.totalSwaps;
    features.dex_uniquePools = aggregated.uniquePools;
    features.dex_uniqueTokensTraded = aggregated.uniqueTokens;
    features.dex_chainsUsed = aggregated.uniqueChains;
    features.dex_avgSwapSizeUsd = aggregated.avgSwapSizeUsd;
    features.dex_swapFrequencyPerHour = aggregated.swapFrequencyPerHour;
    features.dex_hasRecentSwap = aggregated.hasRecentSwap;
    features.dex_swapBeforeExitScore = aggregated.swapBeforeExitScore;
    
  } catch (err) {
    errors.push(`DEX provider error: ${(err as Error).message}`);
    return {
      features: createNullDexFeatures(),
      source: 'DEX',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'DEX',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Aggregation
// ============================================

interface DexAggregation {
  activityScore: number;
  hasSwapBeforeExit: boolean;
  swapCount24h: number;
  totalSwaps: number;
  uniquePools: number;
  uniqueTokens: number;
  uniqueChains: number;
  avgSwapSizeUsd: number;
  swapFrequencyPerHour: number;
  hasRecentSwap: boolean;
  swapBeforeExitScore: number;
}

function aggregateDexFeatures(
  trades: IDexTrade[],
  windowStartTs: number,
  windowEndTs: number
): DexAggregation {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 24 * 60 * 60;
  
  const pools = new Set<string>();
  const tokens = new Set<string>();
  const chains = new Set<string>();
  
  let totalUsdVolume = 0;
  let swapCount24h = 0;
  let hasRecentSwap = false;
  let swapsToStable = 0;
  let latestSwapTs = 0;
  
  for (const trade of trades) {
    // Track unique entities
    pools.add(trade.poolAddress);
    tokens.add(trade.tokenIn);
    tokens.add(trade.tokenOut);
    chains.add(trade.chain);
    
    // USD volume
    const usdValue = trade.amountInUsd || trade.amountOutUsd || 0;
    totalUsdVolume += usdValue;
    
    // 24h swaps
    if (trade.timestamp >= oneDayAgo) {
      swapCount24h++;
      hasRecentSwap = true;
    }
    
    // Swaps to stablecoin (potential pre-exit)
    if (STABLECOINS.has(trade.tokenOut.toLowerCase())) {
      swapsToStable++;
    }
    
    // Track latest
    if (trade.timestamp > latestSwapTs) {
      latestSwapTs = trade.timestamp;
    }
  }
  
  const totalSwaps = trades.length;
  
  // Calculate duration in hours
  const windowHours = Math.max(1, (windowEndTs - windowStartTs) / 3600);
  
  // Activity score (0-1)
  // Based on: frequency, volume, diversity
  const frequencyFactor = Math.min(1, totalSwaps / 50); // 50 swaps = max
  const volumeFactor = Math.min(1, totalUsdVolume / 100000); // $100k = max
  const diversityFactor = Math.min(1, (pools.size + tokens.size) / 20); // 20 unique = max
  const activityScore = (frequencyFactor * 0.4 + volumeFactor * 0.4 + diversityFactor * 0.2);
  
  // Swap-before-exit score
  // Higher if swapping to stablecoins frequently
  const stableRatio = totalSwaps > 0 ? swapsToStable / totalSwaps : 0;
  const swapBeforeExitScore = Math.min(1, stableRatio * 2); // 50% to stable = 1.0
  
  return {
    activityScore: Math.round(activityScore * 100) / 100,
    hasSwapBeforeExit: swapsToStable > 0,
    swapCount24h,
    totalSwaps,
    uniquePools: pools.size,
    uniqueTokens: tokens.size,
    uniqueChains: chains.size,
    avgSwapSizeUsd: totalSwaps > 0 ? Math.round(totalUsdVolume / totalSwaps) : 0,
    swapFrequencyPerHour: Math.round((totalSwaps / windowHours) * 100) / 100,
    hasRecentSwap,
    swapBeforeExitScore: Math.round(swapBeforeExitScore * 100) / 100
  };
}

// ============================================
// Helpers
// ============================================

function createNullDexFeatures(): DexFeatures {
  return {
    dex_activityScore: null,
    dex_swapBeforeExit: null,
    dex_swapCount24h: null,
    dex_swapCountTotal: null,
    dex_uniquePools: null,
    dex_uniqueTokensTraded: null,
    dex_chainsUsed: null,
    dex_avgSwapSizeUsd: null,
    dex_swapFrequencyPerHour: null,
    dex_hasRecentSwap: null,
    dex_swapBeforeExitScore: null
  };
}

/**
 * Get feature count for DEX
 */
export function getDexFeatureCount(): number {
  return 11;
}
