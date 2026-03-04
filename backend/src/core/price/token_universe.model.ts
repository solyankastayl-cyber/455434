/**
 * P0.2a Token Universe Model
 * 
 * Whitelist of tokens to track for price snapshots.
 * Controls what gets screened - NOT the whole market.
 * 
 * Tiers:
 * - core: always tracked (ETH, BTC, major stables)
 * - extended: tracked if enabled
 * - experimental: manual only
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type TokenTier = 'core' | 'extended' | 'experimental';

export interface ITokenUniverse extends Document {
  symbol: string;
  name: string;
  network: string;
  contractAddress?: string;
  coingeckoId?: string;
  
  tier: TokenTier;
  enabled: boolean;
  
  // Metrics for auto-expansion
  requestCount: number;
  lastRequestAt?: Date;
  onchainVolume24h?: number;
  
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const TokenUniverseSchema = new Schema<ITokenUniverse>(
  {
    symbol: { type: String, required: true, index: true },
    name: { type: String, required: true },
    network: { type: String, required: true, index: true },
    contractAddress: { type: String },
    coingeckoId: { type: String },
    
    tier: {
      type: String,
      enum: ['core', 'extended', 'experimental'],
      default: 'extended',
    },
    enabled: { type: Boolean, default: true, index: true },
    
    requestCount: { type: Number, default: 0 },
    lastRequestAt: { type: Date },
    onchainVolume24h: { type: Number },
  },
  {
    timestamps: true,
    collection: 'token_universe',
  }
);

TokenUniverseSchema.index({ symbol: 1, network: 1 }, { unique: true });
TokenUniverseSchema.index({ enabled: 1, tier: 1 });

export const TokenUniverseModel = mongoose.models.TokenUniverse || 
  mongoose.model<ITokenUniverse>('TokenUniverse', TokenUniverseSchema);

// ============================================
// DEFAULT TOKENS (CORE TIER)
// ============================================

const CORE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', coingeckoId: 'ethereum' },
  { symbol: 'WETH', name: 'Wrapped Ethereum', coingeckoId: 'ethereum' },
  { symbol: 'BTC', name: 'Bitcoin', coingeckoId: 'bitcoin' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', coingeckoId: 'bitcoin' },
  { symbol: 'USDC', name: 'USD Coin', coingeckoId: 'usd-coin' },
  { symbol: 'USDT', name: 'Tether', coingeckoId: 'tether' },
  { symbol: 'DAI', name: 'Dai', coingeckoId: 'dai' },
  { symbol: 'ARB', name: 'Arbitrum', coingeckoId: 'arbitrum' },
  { symbol: 'OP', name: 'Optimism', coingeckoId: 'optimism' },
  { symbol: 'MATIC', name: 'Polygon', coingeckoId: 'matic-network' },
  { symbol: 'BNB', name: 'BNB', coingeckoId: 'binancecoin' },
  { symbol: 'LINK', name: 'Chainlink', coingeckoId: 'chainlink' },
  { symbol: 'UNI', name: 'Uniswap', coingeckoId: 'uniswap' },
  { symbol: 'AAVE', name: 'Aave', coingeckoId: 'aave' },
];

// ============================================
// SERVICE FUNCTIONS
// ============================================

/**
 * Initialize core tokens if not exist
 */
export async function initializeCoreTokens(): Promise<void> {
  const networks = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bnb'];
  
  for (const token of CORE_TOKENS) {
    for (const network of networks) {
      try {
        await TokenUniverseModel.updateOne(
          { symbol: token.symbol, network },
          {
            $setOnInsert: {
              symbol: token.symbol,
              name: token.name,
              network,
              coingeckoId: token.coingeckoId,
              tier: 'core',
              enabled: true,
              requestCount: 0,
            },
          },
          { upsert: true }
        );
      } catch (err) {
        // Ignore duplicate key errors
      }
    }
  }
  
  console.log('[TokenUniverse] Core tokens initialized');
}

/**
 * Get enabled tokens for screening
 */
export async function getEnabledTokens(
  limit: number = 500
): Promise<ITokenUniverse[]> {
  return TokenUniverseModel.find({ enabled: true })
    .sort({ tier: 1, requestCount: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get tokens by tier
 */
export async function getTokensByTier(tier: TokenTier): Promise<ITokenUniverse[]> {
  return TokenUniverseModel.find({ tier, enabled: true }).lean();
}

/**
 * Increment request count (for auto-expansion logic)
 */
export async function trackTokenRequest(
  symbol: string,
  network: string
): Promise<void> {
  await TokenUniverseModel.updateOne(
    { symbol, network },
    {
      $inc: { requestCount: 1 },
      $set: { lastRequestAt: new Date() },
    }
  );
}

/**
 * Add token to universe
 */
export async function addToken(
  symbol: string,
  name: string,
  network: string,
  options: {
    tier?: TokenTier;
    coingeckoId?: string;
    contractAddress?: string;
  } = {}
): Promise<ITokenUniverse> {
  return TokenUniverseModel.findOneAndUpdate(
    { symbol, network },
    {
      $setOnInsert: {
        symbol,
        name,
        network,
        tier: options.tier || 'extended',
        enabled: true,
        requestCount: 0,
      },
      $set: {
        coingeckoId: options.coingeckoId,
        contractAddress: options.contractAddress,
      },
    },
    { upsert: true, new: true }
  );
}

/**
 * Get universe stats
 */
export async function getUniverseStats(): Promise<{
  total: number;
  enabled: number;
  byTier: Record<string, number>;
}> {
  const [total, enabled, tierCounts] = await Promise.all([
    TokenUniverseModel.countDocuments(),
    TokenUniverseModel.countDocuments({ enabled: true }),
    TokenUniverseModel.aggregate([
      { $group: { _id: '$tier', count: { $sum: 1 } } },
    ]),
  ]);
  
  const byTier: Record<string, number> = {};
  for (const tc of tierCounts) {
    byTier[tc._id] = tc.count;
  }
  
  return { total, enabled, byTier };
}

export default {
  TokenUniverseModel,
  initializeCoreTokens,
  getEnabledTokens,
  getTokensByTier,
  trackTokenRequest,
  addToken,
  getUniverseStats,
};
