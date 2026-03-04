/**
 * DEX Trade Model (P0.4)
 * 
 * Storage for Uniswap v3 swap events.
 * Part of DEX Layer - intent signals for Route Intelligence.
 */

import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export type DexProtocol = 'UNISWAP_V3' | 'UNISWAP_V2' | 'PANCAKE_V3' | 'SUSHISWAP';
export type SupportedDexChain = 'ETH' | 'ARB' | 'OP' | 'BASE';

export interface IDexTrade {
  tradeId: string;              // deterministic hash (unique)
  
  // Chain info
  chain: SupportedDexChain;
  chainId: number;
  
  // DEX info
  dex: DexProtocol;
  poolAddress: string;
  
  // Transaction info
  txHash: string;
  blockNumber: number;
  logIndex: number;
  timestamp: number;
  
  // Trade participants
  trader: string;               // msg.sender / recipient
  
  // Token info
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  
  // Amounts (raw wei strings for precision)
  amountIn: string;
  amountOut: string;
  
  // USD value (best-effort, nullable)
  amountInUsd?: number | null;
  amountOutUsd?: number | null;
  
  // Optional metrics
  priceImpactBps?: number | null;
  feeTier?: number;             // Uniswap v3 fee tier (500, 3000, 10000)
  
  // Metadata
  ingestionSource: 'rpc';
  createdAt: Date;
}

export interface IDexTradeDocument extends IDexTrade, Document {}

// ============================================
// Schema
// ============================================

const DexTradeSchema = new Schema<IDexTradeDocument>({
  tradeId: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true 
  },
  
  chain: { 
    type: String, 
    required: true, 
    enum: ['ETH', 'ARB', 'OP', 'BASE'],
    index: true 
  },
  chainId: { type: Number, required: true },
  
  dex: { 
    type: String, 
    required: true, 
    enum: ['UNISWAP_V3', 'UNISWAP_V2', 'PANCAKE_V3', 'SUSHISWAP'],
    default: 'UNISWAP_V3'
  },
  poolAddress: { type: String, required: true, lowercase: true, index: true },
  
  txHash: { type: String, required: true, index: true },
  blockNumber: { type: Number, required: true, index: true },
  logIndex: { type: Number, required: true },
  timestamp: { type: Number, required: true, index: true },
  
  trader: { type: String, required: true, lowercase: true, index: true },
  
  tokenIn: { type: String, required: true, lowercase: true, index: true },
  tokenOut: { type: String, required: true, lowercase: true, index: true },
  tokenInSymbol: { type: String },
  tokenOutSymbol: { type: String },
  
  amountIn: { type: String, required: true },
  amountOut: { type: String, required: true },
  
  amountInUsd: { type: Number, default: null },
  amountOutUsd: { type: Number, default: null },
  
  priceImpactBps: { type: Number, default: null },
  feeTier: { type: Number },
  
  ingestionSource: { type: String, default: 'rpc' },
  createdAt: { type: Date, default: Date.now, index: true }
});

// ============================================
// Compound Indexes
// ============================================

// Query by trader activity
DexTradeSchema.index({ trader: 1, timestamp: -1 });

// Query by token activity
DexTradeSchema.index({ tokenIn: 1, timestamp: -1 });
DexTradeSchema.index({ tokenOut: 1, timestamp: -1 });

// Query by pool
DexTradeSchema.index({ poolAddress: 1, blockNumber: -1 });

// Query by chain and block (for ingestion sync)
DexTradeSchema.index({ chain: 1, blockNumber: -1 });

// Query for recent trades
DexTradeSchema.index({ chain: 1, timestamp: -1 });

// Deduplication check
DexTradeSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });

// ============================================
// Model
// ============================================

export const DexTradeModel = mongoose.model<IDexTradeDocument>(
  'dex_trades',
  DexTradeSchema
);

// ============================================
// Chain Config
// ============================================

export const DEX_CHAIN_CONFIG: Record<SupportedDexChain, { chainId: number; name: string }> = {
  ETH: { chainId: 1, name: 'Ethereum' },
  ARB: { chainId: 42161, name: 'Arbitrum' },
  OP: { chainId: 10, name: 'Optimism' },
  BASE: { chainId: 8453, name: 'Base' }
};

// ============================================
// Helper Functions
// ============================================

/**
 * Generate deterministic trade ID
 * Ensures idempotent ingestion
 */
export function generateTradeId(params: {
  chain: string;
  txHash: string;
  logIndex: number;
  poolAddress: string;
  trader: string;
  amountIn: string;
  amountOut: string;
}): string {
  const data = [
    params.chain,
    params.txHash.toLowerCase(),
    params.logIndex.toString(),
    params.poolAddress.toLowerCase(),
    params.trader.toLowerCase(),
    params.amountIn,
    params.amountOut
  ].join(':');
  
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 40);
}

/**
 * Check if trade exists
 */
export async function tradeExists(tradeId: string): Promise<boolean> {
  const count = await DexTradeModel.countDocuments({ tradeId });
  return count > 0;
}

/**
 * Get trades by wallet
 */
export async function getTradesByWallet(
  wallet: string,
  options?: {
    chain?: SupportedDexChain;
    limit?: number;
    startTime?: number;
    endTime?: number;
  }
): Promise<IDexTradeDocument[]> {
  const query: any = {
    trader: wallet.toLowerCase()
  };
  
  if (options?.chain) query.chain = options.chain;
  if (options?.startTime) query.timestamp = { $gte: options.startTime };
  if (options?.endTime) {
    query.timestamp = { ...query.timestamp, $lte: options.endTime };
  }
  
  return DexTradeModel.find(query)
    .sort({ timestamp: -1 })
    .limit(options?.limit || 100)
    .lean();
}

/**
 * Get trades by token
 */
export async function getTradesByToken(
  tokenAddress: string,
  options?: {
    chain?: SupportedDexChain;
    limit?: number;
    direction?: 'in' | 'out' | 'both';
  }
): Promise<IDexTradeDocument[]> {
  const token = tokenAddress.toLowerCase();
  const direction = options?.direction || 'both';
  
  let query: any;
  if (direction === 'in') {
    query = { tokenIn: token };
  } else if (direction === 'out') {
    query = { tokenOut: token };
  } else {
    query = { $or: [{ tokenIn: token }, { tokenOut: token }] };
  }
  
  if (options?.chain) query.chain = options.chain;
  
  return DexTradeModel.find(query)
    .sort({ timestamp: -1 })
    .limit(options?.limit || 100)
    .lean();
}

/**
 * Get trade statistics
 */
export async function getDexStats(chain?: SupportedDexChain): Promise<{
  totalTrades: number;
  tradesByChain: Record<string, number>;
  tradesByDex: Record<string, number>;
  latestTimestamp: number;
  uniqueTraders: number;
}> {
  const matchStage: any = {};
  if (chain) matchStage.chain = chain;
  
  const [chainStats, dexStats, latest, traderCount, total] = await Promise.all([
    // Trades by chain
    DexTradeModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$chain', count: { $sum: 1 } } }
    ]),
    
    // Trades by DEX
    DexTradeModel.aggregate([
      { $match: matchStage },
      { $group: { _id: '$dex', count: { $sum: 1 } } }
    ]),
    
    // Latest timestamp
    DexTradeModel.findOne(matchStage)
      .sort({ timestamp: -1 })
      .select('timestamp')
      .lean(),
    
    // Unique traders
    DexTradeModel.distinct('trader', matchStage),
    
    // Total count
    DexTradeModel.countDocuments(matchStage)
  ]);
  
  return {
    totalTrades: total,
    tradesByChain: chainStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {} as Record<string, number>),
    tradesByDex: dexStats.reduce((acc, s) => {
      acc[s._id] = s.count;
      return acc;
    }, {} as Record<string, number>),
    latestTimestamp: latest?.timestamp || 0,
    uniqueTraders: traderCount.length
  };
}
