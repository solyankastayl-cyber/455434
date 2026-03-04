/**
 * DEX-Route Integration Service (P0.4 -> P0.3)
 * 
 * Enriches Route Intelligence with DEX swap data:
 * - Finds swaps related to route wallets
 * - Creates SWAP segments from DEX trades
 * - Provides swap_before_exit detection
 */

import { 
  DexTradeModel, 
  SupportedDexChain,
  IDexTradeDocument 
} from '../dex_layer/storage/dex_trade.model.js';
import { 
  RouteSegmentModel, 
  IRouteSegment,
  SegmentType 
} from '../route_intelligence/route_segment.model.js';
import { 
  LiquidityRouteModel,
  ILiquidityRoute 
} from '../route_intelligence/liquidity_route.model.js';

// ============================================
// Types
// ============================================

export interface SwapSegmentData {
  type: SegmentType;
  chainFrom: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  walletFrom: string;
  walletTo: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amount: string;
  amountUsd?: number;
  protocol: string;
  protocolType: string;
  dex: string;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  confidence: number;
}

export interface WalletSwapActivity {
  wallet: string;
  swapCount: number;
  swapsLastHour: number;
  swapsLast24h: number;
  totalVolumeUsd: number;
  chainsActive: string[];
  lastSwapAt: Date | null;
  swapBeforeExit: boolean;
  swapBeforeExitDetails?: {
    tradeId: string;
    minutesBefore: number;
    amountUsd: number | null;
  };
}

// ============================================
// Find Related Swaps
// ============================================

/**
 * Find DEX swaps for a wallet within a time window
 */
export async function findWalletSwaps(
  wallet: string,
  options?: {
    chain?: SupportedDexChain;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }
): Promise<IDexTradeDocument[]> {
  const query: any = {
    trader: wallet.toLowerCase()
  };
  
  if (options?.chain) query.chain = options.chain;
  
  if (options?.startTime || options?.endTime) {
    query.timestamp = {};
    if (options.startTime) query.timestamp.$gte = options.startTime;
    if (options.endTime) query.timestamp.$lte = options.endTime;
  }
  
  return DexTradeModel.find(query)
    .sort({ timestamp: -1 })
    .limit(options?.limit || 50)
    .lean();
}

/**
 * Find swaps near a specific timestamp
 */
export async function findSwapsNearTimestamp(
  wallet: string,
  targetTimestamp: number,
  windowSeconds: number = 3600
): Promise<IDexTradeDocument[]> {
  return DexTradeModel.find({
    trader: wallet.toLowerCase(),
    timestamp: {
      $gte: targetTimestamp - windowSeconds,
      $lte: targetTimestamp + windowSeconds
    }
  })
  .sort({ timestamp: 1 })
  .lean();
}

// ============================================
// Convert to Segments
// ============================================

/**
 * Convert DEX trade to route segment
 */
export function dexTradeToSegment(trade: IDexTradeDocument): SwapSegmentData {
  return {
    type: 'SWAP',
    chainFrom: trade.chain,
    txHash: trade.txHash,
    blockNumber: trade.blockNumber,
    timestamp: new Date(trade.timestamp * 1000),
    walletFrom: trade.trader,
    walletTo: trade.trader, // Swap is self-directed
    tokenAddress: trade.tokenIn,
    tokenSymbol: trade.tokenInSymbol,
    amount: trade.amountIn,
    amountUsd: trade.amountInUsd || trade.amountOutUsd || undefined,
    protocol: 'Uniswap V3',
    protocolType: 'DEX',
    dex: trade.dex,
    poolAddress: trade.poolAddress,
    tokenIn: trade.tokenIn,
    tokenOut: trade.tokenOut,
    confidence: 0.9 // DEX swaps have high confidence
  };
}

/**
 * Convert multiple trades to segments
 */
export function dexTradesToSegments(trades: IDexTradeDocument[]): SwapSegmentData[] {
  return trades.map(dexTradeToSegment);
}

// ============================================
// Route Enrichment
// ============================================

/**
 * Enrich a route with DEX swap segments
 * Finds swaps that occurred between route segments
 */
export async function enrichRouteWithSwaps(routeId: string): Promise<{
  swapsFound: number;
  segmentsAdded: number;
}> {
  const result = { swapsFound: 0, segmentsAdded: 0 };
  
  // Get route
  const route = await LiquidityRouteModel.findOne({ routeId }).lean();
  if (!route) return result;
  
  // Get existing segments
  const segments = await RouteSegmentModel.find({ routeId })
    .sort({ index: 1 })
    .lean();
  
  if (segments.length === 0) return result;
  
  // Get time window from route
  const startTime = Math.floor(new Date(route.firstSeenAt).getTime() / 1000);
  const endTime = Math.floor(new Date(route.lastSeenAt).getTime() / 1000) + 3600; // +1h buffer
  
  // Find swaps for the start wallet
  const swaps = await findWalletSwaps(route.startWallet, {
    startTime,
    endTime
  });
  
  result.swapsFound = swaps.length;
  
  if (swaps.length === 0) return result;
  
  // Filter swaps not already in segments (by txHash)
  const existingTxHashes = new Set(segments.map(s => s.txHash));
  const newSwaps = swaps.filter(s => !existingTxHashes.has(s.txHash));
  
  if (newSwaps.length === 0) return result;
  
  // Convert to segments and insert
  let nextIndex = segments.length;
  
  for (const swap of newSwaps) {
    const segmentData = dexTradeToSegment(swap);
    
    await RouteSegmentModel.create({
      routeId,
      index: nextIndex++,
      ...segmentData
    });
    
    result.segmentsAdded++;
  }
  
  // Update route swaps count
  if (result.segmentsAdded > 0) {
    await LiquidityRouteModel.updateOne(
      { routeId },
      {
        $inc: { 
          segmentsCount: result.segmentsAdded,
          swapsCount: result.segmentsAdded 
        },
        $set: { updatedAt: new Date() }
      }
    );
    
    console.log(`[DexRouteIntegration] Enriched route ${routeId} with ${result.segmentsAdded} swap segments`);
  }
  
  return result;
}

/**
 * Batch enrich multiple routes
 */
export async function enrichRoutesWithSwaps(
  routeIds: string[]
): Promise<{ routesProcessed: number; totalSwapsAdded: number }> {
  let totalSwapsAdded = 0;
  
  for (const routeId of routeIds) {
    const { segmentsAdded } = await enrichRouteWithSwaps(routeId);
    totalSwapsAdded += segmentsAdded;
  }
  
  return {
    routesProcessed: routeIds.length,
    totalSwapsAdded
  };
}

// ============================================
// Swap-Before-Exit Detection
// ============================================

/**
 * Detect if wallet had swaps before a CEX deposit
 * Key signal for exit intent
 */
export async function detectSwapBeforeExit(
  wallet: string,
  exitTimestamp: number,
  windowSeconds: number = 3600
): Promise<{
  hasSwapBeforeExit: boolean;
  swaps: Array<{
    tradeId: string;
    timestamp: number;
    minutesBefore: number;
    tokenIn: string;
    tokenOut: string;
    amountUsd: number | null;
  }>;
}> {
  const swaps = await DexTradeModel.find({
    trader: wallet.toLowerCase(),
    timestamp: {
      $gte: exitTimestamp - windowSeconds,
      $lt: exitTimestamp
    }
  })
  .sort({ timestamp: -1 })
  .limit(10)
  .lean();
  
  return {
    hasSwapBeforeExit: swaps.length > 0,
    swaps: swaps.map(s => ({
      tradeId: s.tradeId,
      timestamp: s.timestamp,
      minutesBefore: Math.round((exitTimestamp - s.timestamp) / 60),
      tokenIn: s.tokenIn,
      tokenOut: s.tokenOut,
      amountUsd: s.amountInUsd || s.amountOutUsd || null
    }))
  };
}

/**
 * Get comprehensive swap activity for wallet
 */
export async function getWalletSwapActivity(wallet: string): Promise<WalletSwapActivity> {
  const now = Math.floor(Date.now() / 1000);
  const oneHourAgo = now - 3600;
  const oneDayAgo = now - 86400;
  
  const [allSwaps, recentSwaps, daySwaps] = await Promise.all([
    DexTradeModel.find({ trader: wallet.toLowerCase() })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean(),
    
    DexTradeModel.countDocuments({
      trader: wallet.toLowerCase(),
      timestamp: { $gte: oneHourAgo }
    }),
    
    DexTradeModel.countDocuments({
      trader: wallet.toLowerCase(),
      timestamp: { $gte: oneDayAgo }
    })
  ]);
  
  // Calculate totals
  const totalVolumeUsd = allSwaps.reduce((sum, s) => {
    return sum + (s.amountInUsd || s.amountOutUsd || 0);
  }, 0);
  
  const chainsActive = [...new Set(allSwaps.map(s => s.chain))];
  const lastSwapAt = allSwaps.length > 0 
    ? new Date(allSwaps[0].timestamp * 1000) 
    : null;
  
  // Check for swap before exit pattern
  // Look for recent EXIT routes for this wallet
  const recentExitRoute = await LiquidityRouteModel.findOne({
    startWallet: wallet.toLowerCase(),
    routeType: 'EXIT',
    firstSeenAt: { $gte: new Date(oneDayAgo * 1000) }
  }).sort({ firstSeenAt: -1 }).lean();
  
  let swapBeforeExit = false;
  let swapBeforeExitDetails;
  
  if (recentExitRoute) {
    const exitTime = Math.floor(new Date(recentExitRoute.firstSeenAt).getTime() / 1000);
    const detection = await detectSwapBeforeExit(wallet, exitTime);
    
    if (detection.hasSwapBeforeExit && detection.swaps.length > 0) {
      swapBeforeExit = true;
      swapBeforeExitDetails = {
        tradeId: detection.swaps[0].tradeId,
        minutesBefore: detection.swaps[0].minutesBefore,
        amountUsd: detection.swaps[0].amountUsd
      };
    }
  }
  
  return {
    wallet: wallet.toLowerCase(),
    swapCount: allSwaps.length,
    swapsLastHour: recentSwaps,
    swapsLast24h: daySwaps,
    totalVolumeUsd: Math.round(totalVolumeUsd),
    chainsActive,
    lastSwapAt,
    swapBeforeExit,
    swapBeforeExitDetails
  };
}

// ============================================
// Feature Extraction for ML
// ============================================

/**
 * Extract DEX-related features for ML
 */
export async function extractDexFeatures(wallet: string): Promise<{
  swapCount24h: number;
  swapCountTotal: number;
  avgSwapSizeUsd: number;
  swapFrequencyPerHour: number;
  uniqueTokensTraded: number;
  chainsUsed: number;
  hasRecentSwap: boolean;
  swapBeforeExitScore: number;
}> {
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  const oneWeekAgo = now - 604800;
  
  const [daySwaps, weekSwaps] = await Promise.all([
    DexTradeModel.find({
      trader: wallet.toLowerCase(),
      timestamp: { $gte: oneDayAgo }
    }).lean(),
    
    DexTradeModel.find({
      trader: wallet.toLowerCase(),
      timestamp: { $gte: oneWeekAgo }
    }).lean()
  ]);
  
  // Calculate metrics
  const totalVolumeUsd = weekSwaps.reduce((sum, s) => {
    return sum + (s.amountInUsd || s.amountOutUsd || 0);
  }, 0);
  
  const avgSwapSizeUsd = weekSwaps.length > 0 
    ? totalVolumeUsd / weekSwaps.length 
    : 0;
  
  const swapFrequencyPerHour = weekSwaps.length / (7 * 24); // swaps per hour over week
  
  const uniqueTokens = new Set<string>();
  const chains = new Set<string>();
  
  weekSwaps.forEach(s => {
    uniqueTokens.add(s.tokenIn);
    uniqueTokens.add(s.tokenOut);
    chains.add(s.chain);
  });
  
  const hasRecentSwap = daySwaps.length > 0;
  
  // Calculate swap_before_exit score (0-1)
  // Based on pattern: high swap activity → then quiet → then exit
  let swapBeforeExitScore = 0;
  
  if (daySwaps.length > 0) {
    // Check if there's been swap activity in last hour
    const oneHourAgo = now - 3600;
    const lastHourSwaps = daySwaps.filter(s => s.timestamp >= oneHourAgo);
    
    if (lastHourSwaps.length > 0) {
      // Recent swap activity
      swapBeforeExitScore = Math.min(lastHourSwaps.length * 0.2, 0.8);
      
      // Check total volume
      const hourVolume = lastHourSwaps.reduce((sum, s) => {
        return sum + (s.amountInUsd || s.amountOutUsd || 0);
      }, 0);
      
      if (hourVolume > 50000) swapBeforeExitScore += 0.2;
    }
  }
  
  return {
    swapCount24h: daySwaps.length,
    swapCountTotal: weekSwaps.length,
    avgSwapSizeUsd: Math.round(avgSwapSizeUsd),
    swapFrequencyPerHour: Math.round(swapFrequencyPerHour * 100) / 100,
    uniqueTokensTraded: uniqueTokens.size,
    chainsUsed: chains.size,
    hasRecentSwap,
    swapBeforeExitScore: Math.round(swapBeforeExitScore * 100) / 100
  };
}
