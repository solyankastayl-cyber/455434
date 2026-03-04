/**
 * Token Ranking Model
 * 
 * Stores computed rankings for tokens
 * BUY / WATCH / SELL buckets
 */
import mongoose from 'mongoose';

// Bucket types
export type BucketType = 'BUY' | 'WATCH' | 'SELL';

const TokenRankingSchema = new mongoose.Schema({
  // Token identity
  symbol: {
    type: String,
    required: true,
    index: true,
  },
  
  contractAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  
  chainId: {
    type: Number,
    required: true,
    default: 1,
  },
  
  // Computed scores (0-100)
  marketCapScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  volumeScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  momentumScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  
  // Engine analysis (optional - from DecisionEngine)
  engineConfidence: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
  },
  
  engineRisk: {
    type: Number,
    default: 50,
    min: 0,
    max: 100,
  },
  
  // Actor Signals (Block D v2)
  actorSignalScore: {
    type: Number,
    default: 0,
  },
  
  // ML adjustment (when enabled)
  mlAdjustment: {
    type: Number,
    default: 0,
    min: -10,
    max: 10,
  },
  
  // Final composite score
  compositeScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    index: true,
  },
  
  // Bucket assignment
  bucket: {
    type: String,
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
    index: true,
  },
  
  // Rank within bucket
  bucketRank: {
    type: Number,
    required: true,
  },
  
  // Global rank
  globalRank: {
    type: Number,
    required: true,
    index: true,
  },
  
  // Market data snapshot (for display)
  priceUsd: {
    type: Number,
    required: true,
  },
  
  priceChange24h: {
    type: Number,
    default: 0,
  },
  
  marketCap: {
    type: Number,
    required: true,
  },
  
  volume24h: {
    type: Number,
    required: true,
  },
  
  // Token metadata
  name: {
    type: String,
    required: true,
  },
  
  imageUrl: {
    type: String,
  },
  
  // ============================================================
  // Block D + C5 Fields
  // ============================================================
  
  // C5.3: Engine Mode Badge
  engineMode: {
    type: String,
    enum: ['rules_only', 'rules_with_actors', 'rules_with_engine', 'rules_with_ml'],
    default: 'rules_only',
  },
  
  // C5.4: Coverage Meter
  coverage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100,
  },
  
  coverageLevel: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    default: 'LOW',
  },
  
  // C5.2: Signal Freshness
  signalFreshness: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  
  // C5.5: Stability
  isUnstable: {
    type: Boolean,
    default: false,
  },
  
  stabilityPenalty: {
    type: Number,
    default: 0,
  },
  
  // Timestamps
  computedAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  
  // Source of ranking
  source: {
    type: String,
    enum: ['rules', 'ml_advisor', 'ml_assist'],
    default: 'rules',
  },
}, {
  collection: 'token_rankings',
  timestamps: false,
});

// Compound indexes
TokenRankingSchema.index({ contractAddress: 1, chainId: 1 }, { unique: true });
TokenRankingSchema.index({ bucket: 1, compositeScore: -1 });
TokenRankingSchema.index({ bucket: 1, bucketRank: 1 });

export const TokenRankingModel = mongoose.model('TokenRanking', TokenRankingSchema);
