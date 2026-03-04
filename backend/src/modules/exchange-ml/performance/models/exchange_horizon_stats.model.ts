/**
 * Exchange Auto-Learning Loop - Horizon Performance Statistics Model
 * 
 * Stores rolling performance metrics for each horizon.
 * Used by CrossHorizonBiasService for confidence adjustments.
 */

import { Schema, model, models, Document, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ExchangeHorizon = '1D' | '7D' | '30D';

export interface ExchangeHorizonStats {
  horizon: ExchangeHorizon;
  
  // Sample tracking
  sampleCount: number;
  resolvedCount: number;
  
  // Performance metrics
  rollingWinRate: number;      // 0..1
  rollingLossRate: number;     // 0..1
  
  // Drawdown tracking
  rollingDrawdown: number;     // 0..1
  maxDrawdown: number;         // 0..1 (all-time)
  
  // Stability metrics
  consecutiveLosses: number;
  consecutiveWins: number;
  stabilityScore: number;      // 0..1 (higher = more stable)
  
  // Bias scores
  biasScore: number;           // -1..+1 (positive = performing above average)
  biasConfidence: number;      // 0..1 (based on sample size)
  
  // Timestamps
  updatedAt: Date;
  createdAt: Date;
}

export interface ExchangeHorizonStatsDocument extends ExchangeHorizonStats, Document {}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const ExchangeHorizonStatsSchema = new Schema<ExchangeHorizonStatsDocument>({
  horizon: {
    type: String,
    required: true,
    unique: true,
    enum: ['1D', '7D', '30D'],
  },
  
  // Sample tracking
  sampleCount: { type: Number, default: 0 },
  resolvedCount: { type: Number, default: 0 },
  
  // Performance metrics
  rollingWinRate: { type: Number, default: 0.5 },
  rollingLossRate: { type: Number, default: 0.5 },
  
  // Drawdown tracking
  rollingDrawdown: { type: Number, default: 0 },
  maxDrawdown: { type: Number, default: 0 },
  
  // Stability metrics
  consecutiveLosses: { type: Number, default: 0 },
  consecutiveWins: { type: Number, default: 0 },
  stabilityScore: { type: Number, default: 1 },
  
  // Bias scores
  biasScore: { type: Number, default: 0 },
  biasConfidence: { type: Number, default: 0 },
  
  // Timestamps
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,  // Manual control
  collection: 'exchange_horizon_stats',
});

// Indexes
ExchangeHorizonStatsSchema.index({ horizon: 1 }, { unique: true });
ExchangeHorizonStatsSchema.index({ updatedAt: 1 });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export const ExchangeHorizonStatsModel: Model<ExchangeHorizonStatsDocument> =
  models.ExchangeHorizonStats ||
  model<ExchangeHorizonStatsDocument>('ExchangeHorizonStats', ExchangeHorizonStatsSchema);

console.log('[Exchange ML] Horizon Stats model loaded');
