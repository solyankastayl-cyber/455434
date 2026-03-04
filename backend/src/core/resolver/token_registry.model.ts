/**
 * Token Registry Model (P2.5)
 * 
 * Single source of truth for token metadata
 * Used for address → symbol resolution
 * 
 * Philosophy:
 * - Metadata enrichment, NOT analytics
 * - No inference, no smart guesses
 * - Just translate address → human-readable identifier
 */
import mongoose from 'mongoose';

const TokenRegistrySchema = new mongoose.Schema({
  // Token address (lowercase, indexed)
  address: { 
    type: String, 
    required: true, 
    lowercase: true,
    index: true 
  },
  
  // Chain identifier
  chain: { 
    type: String, 
    enum: ['ethereum', 'arbitrum', 'polygon', 'base', 'optimism', 'avalanche', 'bsc'],
    default: 'ethereum',
    index: true
  },
  
  // Human-readable identifiers
  symbol: { type: String, required: true, index: true },  // USDT
  name: { type: String, required: true },                  // Tether USD
  
  // Technical metadata
  decimals: { type: Number, default: 18 },
  
  // Trust indicators
  verified: { type: Boolean, default: false },  // verified ≠ trusted, just "we checked"
  
  // Data source
  source: { 
    type: String, 
    enum: ['coingecko', 'manual', 'onchain', 'etherscan'],
    default: 'manual'
  },
  
  // Optional metadata
  logo: { type: String },          // Logo URL
  coingeckoId: { type: String },   // For price lookups
  
  // Timestamps
  lastUpdated: { type: Date, default: Date.now },
  
}, {
  collection: 'token_registry',
  timestamps: true,
});

// Compound unique index
TokenRegistrySchema.index({ address: 1, chain: 1 }, { unique: true });

// Text index for search
TokenRegistrySchema.index({ symbol: 'text', name: 'text' });

export const TokenRegistryModel = mongoose.model('TokenRegistry', TokenRegistrySchema);
