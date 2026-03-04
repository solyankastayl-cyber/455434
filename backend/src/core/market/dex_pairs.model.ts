/**
 * DEX Pairs Model (Phase 14A.1)
 * 
 * Tracks DEX pairs for price discovery.
 * Stores what and where to price tokens.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type DexProtocol = 'uniswap_v2' | 'uniswap_v3' | 'sushiswap';
export type ChainId = 'ethereum' | 'polygon' | 'arbitrum' | 'optimism' | 'base';

export interface IDexPair extends Document {
  _id: Types.ObjectId;
  
  // Chain and protocol
  chain: ChainId;
  dex: DexProtocol;
  
  // Pair address
  pairAddress: string;
  
  // Token info
  token0: {
    address: string;
    symbol: string;
    decimals: number;
  };
  token1: {
    address: string;
    symbol: string;
    decimals: number;
  };
  
  // Anchor pair flag (e.g., USDC/WETH)
  isAnchorPair: boolean;
  anchorType?: 'usd' | 'eth';    // What this pair anchors to
  
  // Liquidity hint (for prioritization)
  liquidityHint: number;          // Approximate TVL in USD
  reservesLastUpdated?: Date;
  
  // V3 specific (for future)
  fee?: number;                   // Pool fee tier (3000 = 0.3%)
  tickSpacing?: number;
  
  // Status
  enabled: boolean;
  lastPriceAt?: Date;
  lastError?: string;
  errorCount: number;
  
  createdAt: Date;
  updatedAt: Date;
}

const TokenInfoSchema = new Schema(
  {
    address: { type: String, required: true, lowercase: true },
    symbol: { type: String, required: true },
    decimals: { type: Number, required: true },
  },
  { _id: false }
);

const DexPairSchema = new Schema<IDexPair>(
  {
    chain: {
      type: String,
      enum: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'base'],
      required: true,
      index: true,
    },
    dex: {
      type: String,
      enum: ['uniswap_v2', 'uniswap_v3', 'sushiswap'],
      required: true,
      index: true,
    },
    
    pairAddress: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
    },
    
    token0: { type: TokenInfoSchema, required: true },
    token1: { type: TokenInfoSchema, required: true },
    
    isAnchorPair: { type: Boolean, default: false, index: true },
    anchorType: {
      type: String,
      enum: ['usd', 'eth'],
    },
    
    liquidityHint: { type: Number, default: 0 },
    reservesLastUpdated: Date,
    
    fee: Number,
    tickSpacing: Number,
    
    enabled: { type: Boolean, default: true, index: true },
    lastPriceAt: Date,
    lastError: String,
    errorCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'dex_pairs',
  }
);

// Compound indexes
DexPairSchema.index({ chain: 1, 'token0.address': 1, 'token1.address': 1, dex: 1 });
DexPairSchema.index({ chain: 1, enabled: 1, isAnchorPair: -1, liquidityHint: -1 });

export const DexPairModel = mongoose.model<IDexPair>('DexPair', DexPairSchema);

/**
 * Well-known addresses
 */
export const KNOWN_TOKENS: Record<string, Record<string, { address: string; symbol: string; decimals: number }>> = {
  ethereum: {
    WETH: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
    USDT: { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', decimals: 6 },
    UNI: { address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', symbol: 'UNI', decimals: 18 },
    LINK: { address: '0x514910771af9ca656af840dff83e8264ecf986ca', symbol: 'LINK', decimals: 18 },
    PEPE: { address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 },
  },
  arbitrum: {
    WETH: { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', decimals: 18 },
    USDC: { address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', decimals: 6 },
    USDT: { address: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', symbol: 'USDT', decimals: 6 },
    ARB: { address: '0x912ce59144191c1204e64559fe8253a0e49e6548', symbol: 'ARB', decimals: 18 },
    GMX: { address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', symbol: 'GMX', decimals: 18 },
    MAGIC: { address: '0x539bde0d7dbd336b79148aa742883198bbf60342', symbol: 'MAGIC', decimals: 18 },
  },
};

/**
 * Well-known Uniswap V2 pairs (Ethereum mainnet)
 */
export const KNOWN_PAIRS_V2: { chain?: string; pairAddress: string; token0Symbol: string; token1Symbol: string; isAnchor?: boolean }[] = [
  // Ethereum Mainnet Anchor pairs
  { chain: 'ethereum', pairAddress: '0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc', token0Symbol: 'USDC', token1Symbol: 'WETH', isAnchor: true },
  // Ethereum Token pairs
  { chain: 'ethereum', pairAddress: '0xd3d2e2692501a5c9ca623199d38826e513033a17', token0Symbol: 'UNI', token1Symbol: 'WETH' },
  { chain: 'ethereum', pairAddress: '0xa2107fa5b38d9bbd2c461d6edf11b11a50f6b974', token0Symbol: 'LINK', token1Symbol: 'WETH' },
  // Arbitrum Anchor pairs (SushiSwap V2 style)
  { chain: 'arbitrum', pairAddress: '0x905dfcd5649217c42684f23958568e533c711aa3', token0Symbol: 'USDC', token1Symbol: 'WETH', isAnchor: true },
  // Arbitrum Token pairs
  { chain: 'arbitrum', pairAddress: '0xa6c5c7d189fa4eb5af8ba34e63dcdd3a635d433f', token0Symbol: 'ARB', token1Symbol: 'WETH' },
  { chain: 'arbitrum', pairAddress: '0x80a9ae39310abf666a87c743d6ebbd0e8c42158e', token0Symbol: 'GMX', token1Symbol: 'WETH' },
];
