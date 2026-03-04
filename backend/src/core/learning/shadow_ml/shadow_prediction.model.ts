/**
 * Shadow Prediction Model
 * 
 * ETAP 4.3: Stores shadow ML predictions.
 * 
 * NO INFLUENCE ON SCORE/BUCKET - for comparison and confidence calibration only.
 */
import mongoose from 'mongoose';
import type { Horizon, DriftLevel } from '../learning.types.js';

// ==================== INTERFACE ====================

export interface IShadowPrediction {
  snapshotId: string;
  tokenAddress: string;
  symbol: string;
  horizon: Horizon;
  
  // ML outputs
  p_success: number;
  ml_confidence: number;
  confidence_modifier: number;
  
  // Context
  drift_level: DriftLevel;
  bucket: string;
  rules_confidence: number;
  final_confidence: number;
  
  // Model info
  model_id: string;
  predicted_at: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMA ====================

const ShadowPredictionSchema = new mongoose.Schema<IShadowPrediction>({
  snapshotId: {
    type: String,
    required: true,
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  symbol: {
    type: String,
    required: true,
  },
  horizon: {
    type: String,
    enum: ['1d', '7d', '30d'],
    required: true,
  },
  p_success: {
    type: Number,
    required: true,
    min: 0,
    max: 1,
  },
  ml_confidence: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
  },
  confidence_modifier: {
    type: Number,
    required: true,
    min: 0.4,
    max: 1.2,
  },
  drift_level: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    required: true,
  },
  bucket: {
    type: String,
    enum: ['BUY', 'WATCH', 'SELL'],
    required: true,
  },
  rules_confidence: {
    type: Number,
    required: true,
  },
  final_confidence: {
    type: Number,
    required: true,
  },
  model_id: {
    type: String,
    required: true,
  },
  predicted_at: {
    type: Date,
    required: true,
  },
}, {
  collection: 'shadow_predictions',
  timestamps: true,
});

// Indexes
ShadowPredictionSchema.index({ snapshotId: 1, horizon: 1 }, { unique: true });
ShadowPredictionSchema.index({ tokenAddress: 1, predicted_at: -1 });
ShadowPredictionSchema.index({ horizon: 1 });
ShadowPredictionSchema.index({ predicted_at: -1 });

export const ShadowPredictionModel = mongoose.models.ShadowPredictionV2 as mongoose.Model<IShadowPrediction> ||
  mongoose.model<IShadowPrediction>('ShadowPredictionV2', ShadowPredictionSchema);
