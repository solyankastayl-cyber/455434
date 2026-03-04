/**
 * Uniswap v3 Adapter (P0.4)
 * 
 * Decodes Swap events from RPC logs.
 * Determines tokenIn/tokenOut direction based on amount signs.
 */

import { ethers } from 'ethers';
import {
  SWAP_EVENT_TOPIC,
  SWAP_EVENT_ABI,
  POOL_ABI,
  CHAIN_IDS,
  KNOWN_TOKENS,
  STABLECOINS,
  INGESTION_CONFIG
} from './uniswap_v3.constants.js';
import { 
  IDexTrade, 
  SupportedDexChain, 
  generateTradeId 
} from '../storage/dex_trade.model.js';

// ============================================
// Types
// ============================================

export interface RawSwapLog {
  address: string;          // Pool address
  topics: string[];         // [eventTopic, sender, recipient]
  data: string;             // Encoded non-indexed params
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  blockTimestamp?: number;
}

export interface DecodedSwap {
  poolAddress: string;
  sender: string;
  recipient: string;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tick: number;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp?: number;
}

export interface PoolTokens {
  token0: string;
  token1: string;
  fee?: number;
}

export interface NormalizedSwap {
  poolAddress: string;
  trader: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
  feeTier?: number;
}

// ============================================
// Pool Cache (token0/token1 mapping)
// ============================================

const poolTokenCache = new Map<string, PoolTokens>();

/**
 * Get pool tokens (token0, token1) with caching
 */
export async function getPoolTokens(
  poolAddress: string,
  provider: ethers.Provider
): Promise<PoolTokens | null> {
  const cacheKey = poolAddress.toLowerCase();
  
  if (poolTokenCache.has(cacheKey)) {
    return poolTokenCache.get(cacheKey)!;
  }
  
  try {
    const contract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    
    const [token0, token1, fee] = await Promise.all([
      contract.token0() as Promise<string>,
      contract.token1() as Promise<string>,
      contract.fee().catch(() => undefined) as Promise<number | undefined>
    ]);
    
    const tokens: PoolTokens = {
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      fee
    };
    
    poolTokenCache.set(cacheKey, tokens);
    return tokens;
  } catch (error) {
    console.error(`[UniswapV3] Failed to get pool tokens for ${poolAddress}:`, error);
    return null;
  }
}

/**
 * Clear pool cache (for testing)
 */
export function clearPoolCache(): void {
  poolTokenCache.clear();
}

// ============================================
// Log Decoding
// ============================================

const swapInterface = new ethers.Interface([SWAP_EVENT_ABI]);

/**
 * Decode raw swap log into structured data
 */
export function decodeSwapLog(log: RawSwapLog): DecodedSwap | null {
  try {
    // Verify it's a Swap event
    if (log.topics[0] !== SWAP_EVENT_TOPIC) {
      return null;
    }
    
    // Decode indexed params (sender, recipient)
    const sender = ethers.getAddress('0x' + log.topics[1].slice(26));
    const recipient = ethers.getAddress('0x' + log.topics[2].slice(26));
    
    // Decode non-indexed params
    const decoded = swapInterface.decodeEventLog('Swap', log.data, log.topics);
    
    return {
      poolAddress: log.address.toLowerCase(),
      sender: sender.toLowerCase(),
      recipient: recipient.toLowerCase(),
      amount0: BigInt(decoded.amount0.toString()),
      amount1: BigInt(decoded.amount1.toString()),
      sqrtPriceX96: BigInt(decoded.sqrtPriceX96.toString()),
      liquidity: BigInt(decoded.liquidity.toString()),
      tick: Number(decoded.tick),
      txHash: log.transactionHash.toLowerCase(),
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      timestamp: log.blockTimestamp
    };
  } catch (error) {
    console.error('[UniswapV3] Failed to decode swap log:', error);
    return null;
  }
}

// ============================================
// Trade Direction Logic
// ============================================

/**
 * Determine tokenIn/tokenOut based on amount signs
 * 
 * In Uniswap v3:
 * - Positive amount = token received by pool (user sells this token)
 * - Negative amount = token sent by pool (user buys this token)
 * 
 * So:
 * - amount0 > 0 means token0 is tokenIn (user sold token0)
 * - amount0 < 0 means token0 is tokenOut (user bought token0)
 */
export function determineTradeDirection(
  amount0: bigint,
  amount1: bigint,
  token0: string,
  token1: string
): { tokenIn: string; tokenOut: string; amountIn: string; amountOut: string } {
  // amount0 > 0 means pool received token0 (user sold token0)
  if (amount0 > 0n) {
    return {
      tokenIn: token0,
      tokenOut: token1,
      amountIn: amount0.toString(),
      amountOut: (amount1 < 0n ? -amount1 : amount1).toString()
    };
  } else {
    return {
      tokenIn: token1,
      tokenOut: token0,
      amountIn: (amount1 > 0n ? amount1 : -amount1).toString(),
      amountOut: (amount0 < 0n ? -amount0 : amount0).toString()
    };
  }
}

// ============================================
// Normalization
// ============================================

/**
 * Normalize decoded swap with pool token info
 */
export async function normalizeSwap(
  decoded: DecodedSwap,
  provider: ethers.Provider
): Promise<NormalizedSwap | null> {
  // Get pool tokens
  const poolTokens = await getPoolTokens(decoded.poolAddress, provider);
  if (!poolTokens) {
    return null;
  }
  
  // Determine trade direction
  const direction = determineTradeDirection(
    decoded.amount0,
    decoded.amount1,
    poolTokens.token0,
    poolTokens.token1
  );
  
  return {
    poolAddress: decoded.poolAddress,
    trader: decoded.recipient, // recipient is the actual trader
    tokenIn: direction.tokenIn,
    tokenOut: direction.tokenOut,
    amountIn: direction.amountIn,
    amountOut: direction.amountOut,
    txHash: decoded.txHash,
    blockNumber: decoded.blockNumber,
    logIndex: decoded.logIndex,
    timestamp: decoded.timestamp || 0,
    feeTier: poolTokens.fee
  };
}

// ============================================
// Token Symbol Resolution
// ============================================

/**
 * Get token symbol from known tokens
 */
export function getTokenSymbol(chain: SupportedDexChain, tokenAddress: string): string | undefined {
  const chainTokens = KNOWN_TOKENS[chain];
  if (!chainTokens) return undefined;
  
  return chainTokens[tokenAddress.toLowerCase()]?.symbol;
}

/**
 * Check if token is a stablecoin
 */
export function isStablecoin(chain: SupportedDexChain, tokenAddress: string): boolean {
  const stables = STABLECOINS[chain];
  if (!stables) return false;
  
  return stables.has(tokenAddress.toLowerCase());
}

// ============================================
// Convert to DexTrade
// ============================================

/**
 * Convert normalized swap to DexTrade document
 */
export function toDexTrade(
  normalized: NormalizedSwap,
  chain: SupportedDexChain
): IDexTrade {
  const chainId = CHAIN_IDS[chain];
  
  const tradeId = generateTradeId({
    chain,
    txHash: normalized.txHash,
    logIndex: normalized.logIndex,
    poolAddress: normalized.poolAddress,
    trader: normalized.trader,
    amountIn: normalized.amountIn,
    amountOut: normalized.amountOut
  });
  
  return {
    tradeId,
    chain,
    chainId,
    dex: 'UNISWAP_V3',
    poolAddress: normalized.poolAddress,
    txHash: normalized.txHash,
    blockNumber: normalized.blockNumber,
    logIndex: normalized.logIndex,
    timestamp: normalized.timestamp,
    trader: normalized.trader,
    tokenIn: normalized.tokenIn,
    tokenOut: normalized.tokenOut,
    tokenInSymbol: getTokenSymbol(chain, normalized.tokenIn),
    tokenOutSymbol: getTokenSymbol(chain, normalized.tokenOut),
    amountIn: normalized.amountIn,
    amountOut: normalized.amountOut,
    amountInUsd: null,
    amountOutUsd: null,
    feeTier: normalized.feeTier,
    ingestionSource: 'rpc',
    createdAt: new Date()
  };
}

// ============================================
// Batch Processing
// ============================================

/**
 * Process batch of raw logs into DexTrade objects
 */
export async function processSwapLogs(
  logs: RawSwapLog[],
  chain: SupportedDexChain,
  provider: ethers.Provider
): Promise<{ trades: IDexTrade[]; errors: number }> {
  const trades: IDexTrade[] = [];
  let errors = 0;
  
  for (const log of logs) {
    try {
      // Decode
      const decoded = decodeSwapLog(log);
      if (!decoded) {
        errors++;
        continue;
      }
      
      // Normalize
      const normalized = await normalizeSwap(decoded, provider);
      if (!normalized) {
        errors++;
        continue;
      }
      
      // Convert
      const trade = toDexTrade(normalized, chain);
      trades.push(trade);
    } catch (error) {
      console.error('[UniswapV3] Error processing log:', error);
      errors++;
    }
  }
  
  return { trades, errors };
}

// ============================================
// RPC Log Fetching
// ============================================

/**
 * Fetch swap logs from RPC for a block range
 */
export async function fetchSwapLogs(
  provider: ethers.Provider,
  fromBlock: number,
  toBlock: number
): Promise<RawSwapLog[]> {
  const filter = {
    topics: [SWAP_EVENT_TOPIC],
    fromBlock,
    toBlock
  };
  
  const logs = await provider.getLogs(filter);
  
  // Convert to RawSwapLog format
  return logs.map(log => ({
    address: log.address,
    topics: log.topics as string[],
    data: log.data,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index
  }));
}

/**
 * Fetch swap logs with block timestamps
 */
export async function fetchSwapLogsWithTimestamps(
  provider: ethers.Provider,
  fromBlock: number,
  toBlock: number
): Promise<RawSwapLog[]> {
  const logs = await fetchSwapLogs(provider, fromBlock, toBlock);
  
  // Get unique block numbers
  const blockNumbers = [...new Set(logs.map(l => l.blockNumber))];
  
  // Fetch block timestamps in parallel
  const blockTimestamps = new Map<number, number>();
  
  await Promise.all(
    blockNumbers.map(async (blockNum) => {
      try {
        const block = await provider.getBlock(blockNum);
        if (block) {
          blockTimestamps.set(blockNum, block.timestamp);
        }
      } catch {
        // Ignore - timestamp will be 0
      }
    })
  );
  
  // Attach timestamps to logs
  return logs.map(log => ({
    ...log,
    blockTimestamp: blockTimestamps.get(log.blockNumber) || 0
  }));
}

export { SWAP_EVENT_TOPIC, CHAIN_IDS, INGESTION_CONFIG };
