/**
 * Trend Validation Model
 * 
 * ETAP 3.2: Stores validated trend labels for snapshots.
 * 
 * Converts raw outcomes into:
 * - NOISE | SIDEWAYS | TREND_UP | TREND_DOWN
 * - INSTANT | DELAYED | LATE | NONE
 * 
 * NO ML - pure deterministic rules.
 * IMMUTABLE once created (upsert only by snapshotId).
 */
import mongoose from 'mongoose';
import type { 
  TrendLabel, 
  DelayLabel, 
  TrendHorizonResult, 
  TrendFinal 
} from '../types/trend.types.js';

// ==================== INTERFACE ====================

export interface ITrendValidation {
  snapshotId: string;
  tokenAddress: string;
  
  // Per-horizon results
  horizons: {
    '1d'?: TrendHorizonResult;
    '7d'?: TrendHorizonResult;
    '30d'?: TrendHorizonResult;
  };
  
  // Aggregated final result
  final: TrendFinal;
  
  // Metadata
  validatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMA ====================

const TrendHorizonResultSchema = new mongoose.Schema({
  returnPct: { type: Number, required: true },
  maxDrawdownPct: { type: Number, required: true },
  volumeChangePct: { type: Number, required: true },
  
  label: { 
    type: String, 
    enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN'], 
    required: true 
  },
  strength: { type: Number, required: true, min: 0, max: 1 },
  isSignificant: { type: Boolean, required: true },
  
  notes: [{ type: String }],
}, { _id: false });

const TrendFinalSchema = new mongoose.Schema({
  label: { 
    type: String, 
    enum: ['NOISE', 'SIDEWAYS', 'TREND_UP', 'TREND_DOWN'], 
    required: true 
  },
  delay: { 
    type: String, 
    enum: ['INSTANT', 'DELAYED', 'LATE', 'NONE'], 
    required: true 
  },
  confidence: { type: Number, required: true, min: 0, max: 100 },
  quality: { type: Number, required: true, min: 0, max: 1 },
}, { _id: false });

const TrendValidationSchema = new mongoose.Schema<ITrendValidation>({
  snapshotId: {
    type: String,
    required: true,
    unique: true,
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  horizons: {
    '1d': { type: TrendHorizonResultSchema, required: false },
    '7d': { type: TrendHorizonResultSchema, required: false },
    '30d': { type: TrendHorizonResultSchema, required: false },
  },
  final: {
    type: TrendFinalSchema,
    required: true,
  },
  validatedAt: {
    type: Date,
    required: true,
  },
}, {
  collection: 'trend_validations',
  timestamps: true,
});

// Indexes
TrendValidationSchema.index({ snapshotId: 1 }, { unique: true });
TrendValidationSchema.index({ tokenAddress: 1 });
TrendValidationSchema.index({ 'final.label': 1 });
TrendValidationSchema.index({ 'final.delay': 1 });
TrendValidationSchema.index({ validatedAt: -1 });

export const TrendValidationModel = mongoose.model<ITrendValidation>(
  'TrendValidation',
  TrendValidationSchema
);
