/**
 * Swap Segment Enricher (P0.5 - Key File)
 * 
 * Inserts SWAP segments from dex_trades between route segments.
 * Matching rules:
 * - Same wallet (trader/sender heuristics)
 * - Same chain
 * - Time proximity: ±10 min (configurable)
 * - Token overlap or stablecoin hop allowed
 */

import { DexTradeModel, IDexTradeDocument } from '../../dex_layer/storage/dex_trade.model.js';
import { ISegmentV2 } from '../storage/route_enriched.model.js';

// ============================================
// Config
// ============================================

const ENRICHER_CONFIG = {
  timeWindowMs: 10 * 60 * 1000,  // ±10 minutes
  maxSwapsPerRoute: 20,
  stablecoins: new Set([
    // ETH
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
    '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
    '0x6b175474e89094c44da98b954eedeac495271d0f', // DAI
    // ARB
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831', // USDC
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', // USDT
    '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1', // DAI
    // OP
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85', // USDC
    '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', // USDT
    // BASE
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb'  // DAI
  ])
};

// ============================================
// Types
// ============================================

export interface SwapEnrichmentResult {
  segments: ISegmentV2[];
  swapsAdded: number;
  matchedTrades: string[];  // tradeIds
}

export interface SwapMatch {
  trade: IDexTradeDocument;
  insertAfterIndex: number;
  matchReason: 'time_proximity' | 'token_overlap' | 'stable_hop';
  confidence: number;
}

// ============================================
// Main Enricher
// ============================================

/**
 * Enrich route segments with SWAP segments from DEX trades
 */
export async function enrichSegmentsWithSwaps(
  wallet: string,
  segments: ISegmentV2[],
  windowStart: Date,
  windowEnd: Date
): Promise<SwapEnrichmentResult> {
  const result: SwapEnrichmentResult = {
    segments: [...segments],
    swapsAdded: 0,
    matchedTrades: []
  };
  
  if (segments.length === 0) {
    return result;
  }
  
  // Fetch DEX trades for wallet in window
  const trades = await fetchWalletTrades(wallet, windowStart, windowEnd);
  
  if (trades.length === 0) {
    return result;
  }
  
  // Get existing txHashes to avoid duplicates
  const existingTxHashes = new Set(segments.map(s => s.txHash.toLowerCase()));
  
  // Find matching swaps
  const matches = findSwapMatches(trades, segments, existingTxHashes);
  
  if (matches.length === 0) {
    return result;
  }
  
  // Sort matches by insert position (descending to insert from end)
  matches.sort((a, b) => b.insertAfterIndex - a.insertAfterIndex);
  
  // Insert swap segments
  for (const match of matches.slice(0, ENRICHER_CONFIG.maxSwapsPerRoute)) {
    const swapSegment = tradeToSegment(match.trade, match.insertAfterIndex + 1, match.confidence);
    
    // Insert after the matched index
    result.segments.splice(match.insertAfterIndex + 1, 0, swapSegment);
    result.swapsAdded++;
    result.matchedTrades.push(match.trade.tradeId);
  }
  
  // Reindex all segments
  result.segments = result.segments.map((seg, idx) => ({
    ...seg,
    index: idx
  }));
  
  return result;
}

// ============================================
// Trade Fetching
// ============================================

/**
 * Fetch DEX trades for wallet in time window
 */
async function fetchWalletTrades(
  wallet: string,
  windowStart: Date,
  windowEnd: Date
): Promise<IDexTradeDocument[]> {
  const startTimestamp = Math.floor(windowStart.getTime() / 1000);
  const endTimestamp = Math.floor(windowEnd.getTime() / 1000);
  
  return DexTradeModel.find({
    trader: wallet.toLowerCase(),
    timestamp: { 
      $gte: startTimestamp - ENRICHER_CONFIG.timeWindowMs / 1000,
      $lte: endTimestamp + ENRICHER_CONFIG.timeWindowMs / 1000
    }
  })
  .sort({ timestamp: 1 })
  .limit(ENRICHER_CONFIG.maxSwapsPerRoute * 2)
  .lean();
}

// ============================================
// Matching Logic
// ============================================

/**
 * Find which swaps match route segments
 */
function findSwapMatches(
  trades: IDexTradeDocument[],
  segments: ISegmentV2[],
  existingTxHashes: Set<string>
): SwapMatch[] {
  const matches: SwapMatch[] = [];
  
  for (const trade of trades) {
    // Skip if already in segments
    if (existingTxHashes.has(trade.txHash.toLowerCase())) {
      continue;
    }
    
    // Find best matching position
    const match = findBestMatchPosition(trade, segments);
    
    if (match) {
      matches.push(match);
    }
  }
  
  return matches;
}

/**
 * Find best position to insert swap
 */
function findBestMatchPosition(
  trade: IDexTradeDocument,
  segments: ISegmentV2[]
): SwapMatch | null {
  const tradeTimestamp = trade.timestamp * 1000;
  let bestMatch: SwapMatch | null = null;
  let bestScore = 0;
  
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const segmentTime = new Date(segment.timestamp).getTime();
    
    // Check same chain
    if (segment.chainFrom !== trade.chain) {
      continue;
    }
    
    // Check time proximity
    const timeDiff = Math.abs(tradeTimestamp - segmentTime);
    if (timeDiff > ENRICHER_CONFIG.timeWindowMs) {
      continue;
    }
    
    // Calculate match score
    const { score, reason } = calculateMatchScore(trade, segment, timeDiff);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = {
        trade,
        insertAfterIndex: tradeTimestamp >= segmentTime ? i : Math.max(0, i - 1),
        matchReason: reason,
        confidence: Math.min(score, 0.95)
      };
    }
  }
  
  // Minimum score threshold
  if (bestScore < 0.3) {
    return null;
  }
  
  return bestMatch;
}

/**
 * Calculate match score between trade and segment
 */
function calculateMatchScore(
  trade: IDexTradeDocument,
  segment: ISegmentV2,
  timeDiff: number
): { score: number; reason: 'time_proximity' | 'token_overlap' | 'stable_hop' } {
  let score = 0;
  let reason: 'time_proximity' | 'token_overlap' | 'stable_hop' = 'time_proximity';
  
  // Time proximity score (0-0.3)
  const timeScore = 1 - (timeDiff / ENRICHER_CONFIG.timeWindowMs);
  score += timeScore * 0.3;
  
  // Token overlap score (0-0.5)
  const segmentToken = segment.tokenAddress.toLowerCase();
  const tradeTokenIn = trade.tokenIn.toLowerCase();
  const tradeTokenOut = trade.tokenOut.toLowerCase();
  
  if (segmentToken === tradeTokenIn || segmentToken === tradeTokenOut) {
    score += 0.5;
    reason = 'token_overlap';
  }
  
  // Stablecoin hop score (0-0.3)
  if (isStablecoin(tradeTokenIn) || isStablecoin(tradeTokenOut)) {
    score += 0.2;
    if (reason !== 'token_overlap') {
      reason = 'stable_hop';
    }
  }
  
  // Wallet connection score (0-0.2)
  // If swap connects segments (segment.to -> trade -> next segment.from)
  if (segment.walletTo.toLowerCase() === trade.trader.toLowerCase()) {
    score += 0.2;
  }
  
  return { score, reason };
}

/**
 * Check if token is stablecoin
 */
function isStablecoin(tokenAddress: string): boolean {
  return ENRICHER_CONFIG.stablecoins.has(tokenAddress.toLowerCase());
}

// ============================================
// Conversion
// ============================================

/**
 * Convert DEX trade to segment
 */
function tradeToSegment(
  trade: IDexTradeDocument,
  index: number,
  confidence: number
): ISegmentV2 {
  return {
    index,
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
    tokenInSymbol: trade.tokenInSymbol,
    tokenOutSymbol: trade.tokenOutSymbol,
    confidence
  };
}

// ============================================
// Analysis
// ============================================

/**
 * Check if route has swap-before-exit pattern
 */
export function hasSwapBeforeExitPattern(segments: ISegmentV2[]): boolean {
  // Look for SWAP followed by CEX_DEPOSIT within 3 segments
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i].type === 'SWAP') {
      // Check next 3 segments for CEX_DEPOSIT
      for (let j = i + 1; j < Math.min(i + 4, segments.length); j++) {
        if (segments[j].type === 'CEX_DEPOSIT') {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check if route has swap-to-stable pattern
 */
export function hasSwapToStablePattern(segments: ISegmentV2[]): boolean {
  for (const segment of segments) {
    if (segment.type === 'SWAP' && segment.tokenOut) {
      if (isStablecoin(segment.tokenOut)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get swap count in segments
 */
export function countSwaps(segments: ISegmentV2[]): number {
  return segments.filter(s => s.type === 'SWAP').length;
}

export { ENRICHER_CONFIG, isStablecoin };
