/**
 * Token Universe Model
 * 
 * Registry of all tokens for analysis
 * Extended for Ranking & Decision Engine
 */
import mongoose from 'mongoose';

const TokenUniverseSchema = new mongoose.Schema({
  // Identity
  symbol: {
    type: String,
    required: true,
    index: true,
    uppercase: true,
  },
  
  name: {
    type: String,
    required: true,
  },
  
  contractAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  
  chainId: {
    type: Number,
    required: true,
    default: 1, // Ethereum mainnet
  },
  
  decimals: {
    type: Number,
    default: 18,
  },
  
  // Market Data (extended for Ranking)
  marketCap: {
    type: Number,
    required: true,
  },
  
  volume24h: {
    type: Number,
    required: true,
  },
  
  liquidity: {
    type: Number,
    default: 0,
  },
  
  priceUsd: {
    type: Number,
    required: true,
  },
  
  // Price Changes (for Ranking logic)
  priceChange24h: {
    type: Number,
    default: 0,
  },
  
  priceChange7d: {
    type: Number,
    default: 0,
  },
  
  // Rankings (from CoinGecko)
  marketCapRank: {
    type: Number,
    default: null,
  },
  
  // Metadata
  sector: {
    type: String,
    required: false,
  },
  
  category: {
    type: String,
    required: false,
  },
  
  coingeckoId: {
    type: String,
    required: false,
    index: true,
  },
  
  // Image URL
  imageUrl: {
    type: String,
    required: false,
  },
  
  // Status
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  
  lastUpdated: {
    type: Date,
    default: Date.now,
    index: true,
  },
  
  lastSyncedAt: {
    type: Date,
    default: Date.now,
  },
  
  // Source tracking
  source: {
    type: String,
    enum: ['coingecko', 'dexscreener', 'cmc', 'seed'],
    default: 'coingecko',
  },
  
  ingestedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'token_universe',
  timestamps: false,
});

// Indexes
TokenUniverseSchema.index({ symbol: 1 });
TokenUniverseSchema.index({ contractAddress: 1, chainId: 1 }, { unique: true });
TokenUniverseSchema.index({ active: 1, marketCap: -1 });
TokenUniverseSchema.index({ lastUpdated: 1 });
TokenUniverseSchema.index({ marketCapRank: 1 });

export const TokenUniverseModel = mongoose.model('TokenUniverse', TokenUniverseSchema);
