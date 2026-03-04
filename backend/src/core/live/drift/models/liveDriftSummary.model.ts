/**
 * Live Drift Summary Model
 * 
 * Stores SIM vs LIVE comparison results.
 * Used by ML Ready to determine training eligibility.
 */
import mongoose from 'mongoose';
import type { DriftLevel, DriftMetrics, DriftPercentages } from '../drift.types.js';

export interface ILiveDriftSummary {
  // Identity
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  
  // Window
  window: '1h' | '6h' | '24h';
  windowStart: Date;
  windowEnd: Date;
  
  // SIM metrics (from simulation layer)
  sim: DriftMetrics;
  
  // LIVE metrics (from approved facts)
  live: DriftMetrics;
  
  // Drift calculations
  drift: DriftPercentages;
  
  // Final level
  level: DriftLevel;
  
  // Metadata
  computedAt: Date;
}

const DriftMetricsSchema = new mongoose.Schema({
  volume: { type: Number, required: true, default: 0 },
  netFlow: { type: Number, required: true, default: 0 },
  actorCount: { type: Number, required: true, default: 0 },
}, { _id: false });

const DriftPercentagesSchema = new mongoose.Schema({
  volumePct: { type: Number, required: true, default: 0 },
  netFlowPct: { type: Number, required: true, default: 0 },
  actorPct: { type: Number, required: true, default: 0 },
  composite: { type: Number, required: true, default: 0 },
}, { _id: false });

const LiveDriftSummarySchema = new mongoose.Schema<ILiveDriftSummary>({
  chainId: {
    type: Number,
    required: true,
    default: 1,
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  tokenSymbol: {
    type: String,
    required: true,
  },
  window: {
    type: String,
    enum: ['1h', '6h', '24h'],
    required: true,
  },
  windowStart: {
    type: Date,
    required: true,
  },
  windowEnd: {
    type: Date,
    required: true,
  },
  sim: {
    type: DriftMetricsSchema,
    required: true,
  },
  live: {
    type: DriftMetricsSchema,
    required: true,
  },
  drift: {
    type: DriftPercentagesSchema,
    required: true,
  },
  level: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true,
  },
  computedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'live_drift_summaries',
  timestamps: false,
});

// Unique index: one summary per (chain, token, window, windowStart)
LiveDriftSummarySchema.index(
  { chainId: 1, tokenAddress: 1, window: 1, windowStart: 1 },
  { unique: true }
);

// Query indexes
LiveDriftSummarySchema.index({ tokenAddress: 1, window: 1, windowStart: -1 });
LiveDriftSummarySchema.index({ level: 1 });
LiveDriftSummarySchema.index({ computedAt: -1 });

export const LiveDriftSummaryModel = mongoose.model<ILiveDriftSummary>(
  'LiveDriftSummary',
  LiveDriftSummarySchema
);
