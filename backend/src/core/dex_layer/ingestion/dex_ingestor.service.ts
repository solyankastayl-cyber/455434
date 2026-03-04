/**
 * DEX Ingestor Service (P0.4)
 * 
 * Ingests DEX swap events using P0.1 Ingestion Control infrastructure.
 * - Uses BlockWindowEngine for deterministic processing
 * - Respects RPCBudgetManager limits
 * - Does NOT maintain own sync state
 */

import { ethers } from 'ethers';
import {
  fetchSwapLogsWithTimestamps,
  processSwapLogs,
  CHAIN_IDS,
  INGESTION_CONFIG
} from '../adapters/uniswap_v3.adapter.js';
import {
  safeBatchInsert,
  prepareTradesForInsert,
  BatchInsertResult
} from './dex_deduplicator.js';
import { 
  IDexTrade, 
  SupportedDexChain,
  getDexStats 
} from '../storage/dex_trade.model.js';

// ============================================
// Types
// ============================================

export interface IngestionResult {
  chain: SupportedDexChain;
  fromBlock: number;
  toBlock: number;
  logsFound: number;
  tradesProcessed: number;
  inserted: number;
  duplicates: number;
  errors: number;
  duration: number;
}

export interface IngestionStats {
  totalIngestions: number;
  totalInserted: number;
  totalDuplicates: number;
  totalErrors: number;
  byChain: Record<string, {
    ingestions: number;
    inserted: number;
    lastBlock: number;
  }>;
}

// ============================================
// RPC Provider Cache
// ============================================

const providerCache = new Map<string, ethers.Provider>();

/**
 * Get or create provider for chain
 */
export function getProvider(chain: SupportedDexChain, rpcUrl: string): ethers.Provider {
  const cacheKey = `${chain}:${rpcUrl}`;
  
  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey)!;
  }
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  providerCache.set(cacheKey, provider);
  return provider;
}

/**
 * Clear provider cache
 */
export function clearProviderCache(): void {
  providerCache.clear();
}

// ============================================
// Core Ingestion
// ============================================

/**
 * Ingest swaps for a block range
 */
export async function ingestSwapsForRange(
  chain: SupportedDexChain,
  fromBlock: number,
  toBlock: number,
  rpcUrl: string
): Promise<IngestionResult> {
  const startTime = Date.now();
  const result: IngestionResult = {
    chain,
    fromBlock,
    toBlock,
    logsFound: 0,
    tradesProcessed: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration: 0
  };
  
  try {
    const provider = getProvider(chain, rpcUrl);
    
    // Fetch logs with timestamps
    const logs = await fetchSwapLogsWithTimestamps(provider, fromBlock, toBlock);
    result.logsFound = logs.length;
    
    if (logs.length === 0) {
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Process logs into trades
    const { trades, errors: processErrors } = await processSwapLogs(logs, chain, provider);
    result.tradesProcessed = trades.length;
    result.errors = processErrors;
    
    if (trades.length === 0) {
      result.duration = Date.now() - startTime;
      return result;
    }
    
    // Insert with deduplication
    const insertResult = await safeBatchInsert(trades);
    result.inserted = insertResult.inserted;
    result.duplicates = insertResult.duplicates;
    result.errors += insertResult.errors;
    
    console.log(
      `[DexIngestor] ${chain} blocks ${fromBlock}-${toBlock}: ` +
      `${logs.length} logs → ${trades.length} trades → ${insertResult.inserted} inserted ` +
      `(${insertResult.duplicates} dupes, ${result.errors} errors)`
    );
    
  } catch (error: any) {
    console.error(`[DexIngestor] Error ingesting ${chain} ${fromBlock}-${toBlock}:`, error.message);
    result.errors++;
  }
  
  result.duration = Date.now() - startTime;
  return result;
}

/**
 * Ingest swaps in batches (for large ranges)
 */
export async function ingestSwapsInBatches(
  chain: SupportedDexChain,
  fromBlock: number,
  toBlock: number,
  rpcUrl: string,
  options?: {
    batchSize?: number;
    delayBetweenBatches?: number;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<IngestionResult> {
  const batchSize = options?.batchSize || INGESTION_CONFIG.BLOCKS_PER_BATCH;
  const delay = options?.delayBetweenBatches || INGESTION_CONFIG.MIN_DELAY_BETWEEN_REQUESTS_MS;
  
  const totalResult: IngestionResult = {
    chain,
    fromBlock,
    toBlock,
    logsFound: 0,
    tradesProcessed: 0,
    inserted: 0,
    duplicates: 0,
    errors: 0,
    duration: 0
  };
  
  const startTime = Date.now();
  let currentBlock = fromBlock;
  let batchNum = 0;
  const totalBatches = Math.ceil((toBlock - fromBlock + 1) / batchSize);
  
  while (currentBlock <= toBlock) {
    const batchEnd = Math.min(currentBlock + batchSize - 1, toBlock);
    
    const batchResult = await ingestSwapsForRange(chain, currentBlock, batchEnd, rpcUrl);
    
    // Accumulate results
    totalResult.logsFound += batchResult.logsFound;
    totalResult.tradesProcessed += batchResult.tradesProcessed;
    totalResult.inserted += batchResult.inserted;
    totalResult.duplicates += batchResult.duplicates;
    totalResult.errors += batchResult.errors;
    
    batchNum++;
    if (options?.onProgress) {
      options.onProgress(batchNum, totalBatches);
    }
    
    currentBlock = batchEnd + 1;
    
    // Rate limiting delay
    if (currentBlock <= toBlock && delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  totalResult.duration = Date.now() - startTime;
  return totalResult;
}

// ============================================
// Chain-Specific Ingestion
// ============================================

/**
 * Get RPC URL for chain from environment
 */
export function getRpcUrl(chain: SupportedDexChain): string {
  const envVars: Record<SupportedDexChain, string> = {
    ETH: process.env.ETH_RPC_URL || process.env.INFURA_URL || '',
    ARB: process.env.ARB_RPC_URL || process.env.ANKR_ARB_URL || '',
    OP: process.env.OP_RPC_URL || process.env.ANKR_OP_URL || '',
    BASE: process.env.BASE_RPC_URL || process.env.ANKR_BASE_URL || ''
  };
  
  const url = envVars[chain];
  if (!url) {
    throw new Error(`No RPC URL configured for chain ${chain}`);
  }
  
  return url;
}

/**
 * Ingest recent swaps for a chain (last N blocks)
 */
export async function ingestRecentSwaps(
  chain: SupportedDexChain,
  blockCount: number = 1000
): Promise<IngestionResult> {
  const rpcUrl = getRpcUrl(chain);
  const provider = getProvider(chain, rpcUrl);
  
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = currentBlock - blockCount;
  
  return ingestSwapsInBatches(chain, fromBlock, currentBlock, rpcUrl);
}

// ============================================
// Multi-Chain Ingestion
// ============================================

/**
 * Ingest swaps from all supported chains
 */
export async function ingestAllChains(
  blockCount: number = 500
): Promise<Record<SupportedDexChain, IngestionResult | { error: string }>> {
  const chains: SupportedDexChain[] = ['ETH', 'ARB', 'OP', 'BASE'];
  const results: Record<string, IngestionResult | { error: string }> = {};
  
  for (const chain of chains) {
    try {
      results[chain] = await ingestRecentSwaps(chain, blockCount);
    } catch (error: any) {
      results[chain] = { error: error.message };
      console.error(`[DexIngestor] Failed to ingest ${chain}:`, error.message);
    }
  }
  
  return results as Record<SupportedDexChain, IngestionResult | { error: string }>;
}

// ============================================
// Service Status
// ============================================

/**
 * Get ingestion service status
 */
export async function getIngestionStatus(): Promise<{
  healthy: boolean;
  stats: Awaited<ReturnType<typeof getDexStats>>;
  chainStatus: Record<SupportedDexChain, { connected: boolean; latestBlock?: number }>;
}> {
  const chains: SupportedDexChain[] = ['ETH', 'ARB', 'OP', 'BASE'];
  const chainStatus: Record<string, { connected: boolean; latestBlock?: number }> = {};
  
  for (const chain of chains) {
    try {
      const rpcUrl = getRpcUrl(chain);
      const provider = getProvider(chain, rpcUrl);
      const blockNumber = await provider.getBlockNumber();
      chainStatus[chain] = { connected: true, latestBlock: blockNumber };
    } catch {
      chainStatus[chain] = { connected: false };
    }
  }
  
  const stats = await getDexStats();
  const connectedChains = Object.values(chainStatus).filter(s => s.connected).length;
  
  return {
    healthy: connectedChains >= 2, // At least 2 chains connected
    stats,
    chainStatus: chainStatus as Record<SupportedDexChain, { connected: boolean; latestBlock?: number }>
  };
}

// ============================================
// Seed Test Data
// ============================================

/**
 * Seed test DEX trades for development
 */
export async function seedTestTrades(): Promise<{ inserted: number; duplicates: number }> {
  const testTrades: Partial<IDexTrade>[] = [
    {
      chain: 'ETH',
      chainId: 1,
      dex: 'UNISWAP_V3',
      poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
      txHash: '0xtest123456789abcdef000001',
      blockNumber: 18500000,
      logIndex: 0,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
      trader: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
      tokenIn: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      tokenOut: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      tokenInSymbol: 'WETH',
      tokenOutSymbol: 'USDC',
      amountIn: '10000000000000000000', // 10 ETH
      amountOut: '25000000000', // 25,000 USDC
      amountInUsd: 25000,
      amountOutUsd: 25000,
      feeTier: 3000
    },
    {
      chain: 'ARB',
      chainId: 42161,
      dex: 'UNISWAP_V3',
      poolAddress: '0xc6962004f452be9203591991d15f6b388e09e8d0',
      txHash: '0xtest123456789abcdef000002',
      blockNumber: 150000000,
      logIndex: 0,
      timestamp: Math.floor(Date.now() / 1000) - 1800,
      trader: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      tokenIn: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      tokenOut: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      tokenInSymbol: 'USDC',
      tokenOutSymbol: 'WETH',
      amountIn: '50000000000', // 50,000 USDC
      amountOut: '20000000000000000000', // 20 ETH
      amountInUsd: 50000,
      amountOutUsd: 50000,
      feeTier: 500
    },
    {
      chain: 'BASE',
      chainId: 8453,
      dex: 'UNISWAP_V3',
      poolAddress: '0xd0b53d9277642d899df5c87a3966a349a798f224',
      txHash: '0xtest123456789abcdef000003',
      blockNumber: 8000000,
      logIndex: 0,
      timestamp: Math.floor(Date.now() / 1000) - 600,
      trader: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
      tokenIn: '0x4200000000000000000000000000000000000006',
      tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      tokenInSymbol: 'WETH',
      tokenOutSymbol: 'USDC',
      amountIn: '5000000000000000000', // 5 ETH
      amountOut: '12500000000', // 12,500 USDC
      amountInUsd: 12500,
      amountOutUsd: 12500,
      feeTier: 3000
    }
  ];
  
  const { valid, invalid } = prepareTradesForInsert(testTrades);
  
  if (invalid.length > 0) {
    console.warn('[DexIngestor] Invalid test trades:', invalid);
  }
  
  const result = await safeBatchInsert(valid);
  
  console.log(`[DexIngestor] Seeded ${result.inserted} test trades (${result.duplicates} duplicates)`);
  
  return {
    inserted: result.inserted,
    duplicates: result.duplicates
  };
}

export { CHAIN_IDS };
