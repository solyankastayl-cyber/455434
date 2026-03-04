/**
 * Token Registry Model (P0.2.1)
 * 
 * Single source of truth for tokens across all chains
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type TokenStatus = 'ACTIVE' | 'DEPRECATED' | 'UNKNOWN';
export type TokenSource = 'rpc' | 'manual' | 'coingecko' | 'list';

export interface TokenMetadata {
  symbol: string;
  name: string;
  decimals: number;
  isNativeWrapped: boolean;
  status: TokenStatus;
  sources: TokenSource[];
}

// ============================================
// Token Registry Document
// ============================================

export interface ITokenRegistryDocument extends Document {
  tokenId: string;           // TOKEN:<CHAIN>:<address>
  chain: string;
  chainId: number | string;
  address: string;           // lowercase
  
  symbol: string;
  name: string;
  decimals: number;
  
  isNativeWrapped: boolean;  // WETH, WBNB, etc
  status: TokenStatus;
  sources: TokenSource[];
  
  createdAt: Date;
  updatedAt: Date;
}

const TokenRegistrySchema = new Schema<ITokenRegistryDocument>({
  tokenId: { type: String, required: true, unique: true, index: true },
  chain: { type: String, required: true, index: true },
  chainId: { type: Schema.Types.Mixed, required: true },
  address: { type: String, required: true },
  
  symbol: { type: String, default: 'UNKNOWN' },
  name: { type: String, default: 'Unknown Token' },
  decimals: { type: Number, default: 18 },
  
  isNativeWrapped: { type: Boolean, default: false },
  status: { 
    type: String, 
    enum: ['ACTIVE', 'DEPRECATED', 'UNKNOWN'],
    default: 'UNKNOWN'
  },
  sources: [{ 
    type: String, 
    enum: ['rpc', 'manual', 'coingecko', 'list']
  }],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound unique index
TokenRegistrySchema.index({ chain: 1, address: 1 }, { unique: true });
TokenRegistrySchema.index({ symbol: 1 });
TokenRegistrySchema.index({ updatedAt: -1 });

export const TokenRegistryModel = mongoose.model<ITokenRegistryDocument>(
  'token_registry',
  TokenRegistrySchema
);

// ============================================
// Token Canonical Map Document
// ============================================

export type CanonicalRule = 'MANUAL' | 'COINGECKO' | 'HEURISTIC';

export interface TokenVariant {
  chain: string;
  address: string;
  tokenId: string;
}

export interface ITokenCanonicalMapDocument extends Document {
  canonicalId: string;       // CANON:USDC or CANON:<coingeckoId>
  symbol: string;
  name: string;
  coingeckoId?: string;
  
  variants: TokenVariant[];
  confidence: number;        // 0-1
  rule: CanonicalRule;
  
  createdAt: Date;
  updatedAt: Date;
}

const TokenVariantSchema = new Schema({
  chain: { type: String, required: true },
  address: { type: String, required: true },
  tokenId: { type: String, required: true }
}, { _id: false });

const TokenCanonicalMapSchema = new Schema<ITokenCanonicalMapDocument>({
  canonicalId: { type: String, required: true, unique: true, index: true },
  symbol: { type: String, required: true, index: true },
  name: { type: String, required: true },
  coingeckoId: { type: String, index: true },
  
  variants: [TokenVariantSchema],
  confidence: { type: Number, required: true, min: 0, max: 1 },
  rule: {
    type: String,
    enum: ['MANUAL', 'COINGECKO', 'HEURISTIC'],
    required: true
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

TokenCanonicalMapSchema.index({ symbol: 1 });

export const TokenCanonicalMapModel = mongoose.model<ITokenCanonicalMapDocument>(
  'token_canonical_map',
  TokenCanonicalMapSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate tokenId from chain and address
 */
export function generateTokenId(chain: string, address: string): string {
  return `TOKEN:${chain.toUpperCase()}:${address.toLowerCase()}`;
}

/**
 * Parse tokenId into components
 */
export function parseTokenId(tokenId: string): { chain: string; address: string } | null {
  const parts = tokenId.split(':');
  if (parts.length !== 3 || parts[0] !== 'TOKEN') return null;
  
  return {
    chain: parts[1],
    address: parts[2]
  };
}

/**
 * Check if token exists
 */
export async function tokenExists(chain: string, address: string): Promise<boolean> {
  const count = await TokenRegistryModel.countDocuments({
    chain: chain.toUpperCase(),
    address: address.toLowerCase()
  });
  return count > 0;
}

/**
 * Get token by chain and address
 */
export async function getToken(
  chain: string,
  address: string
): Promise<ITokenRegistryDocument | null> {
  return TokenRegistryModel.findOne({
    chain: chain.toUpperCase(),
    address: address.toLowerCase()
  }).lean();
}

/**
 * Search tokens
 */
export async function searchTokens(options: {
  q?: string;
  chain?: string;
  symbol?: string;
  limit?: number;
}): Promise<ITokenRegistryDocument[]> {
  const query: any = {};
  
  if (options.chain) {
    query.chain = options.chain.toUpperCase();
  }
  
  if (options.symbol) {
    query.symbol = new RegExp(options.symbol, 'i');
  }
  
  if (options.q) {
    query.$or = [
      { symbol: new RegExp(options.q, 'i') },
      { name: new RegExp(options.q, 'i') },
      { address: new RegExp(options.q, 'i') }
    ];
  }
  
  return TokenRegistryModel.find(query)
    .sort({ updatedAt: -1 })
    .limit(options.limit || 100)
    .lean();
}
