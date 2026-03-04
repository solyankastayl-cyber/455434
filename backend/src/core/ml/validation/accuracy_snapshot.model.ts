/**
 * ML Accuracy Snapshots Model - ML v2.1 STEP 2
 * 
 * Stores aggregated accuracy metrics over time windows.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type Horizon = '1h' | '4h' | '24h';
export type Window = '1d' | '3d' | '7d' | '14d';

export interface IAccuracySnapshot extends Document {
  modelVersion: string;
  network: string;
  horizon: Horizon;
  window: Window;
  
  // Counts
  total: number;
  correct: number;
  wrong: number;
  neutral: number;
  skipped: number;
  
  // Metrics
  accuracy: number;
  confidenceWeightedAccuracy: number;
  avgConfidence: number;
  
  // Timestamps
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const AccuracySnapshotSchema = new Schema<IAccuracySnapshot>(
  {
    modelVersion: { type: String, required: true, index: true },
    network: { type: String, required: true, index: true },
    horizon: { 
      type: String, 
      enum: ['1h', '4h', '24h'], 
      default: '4h',
      index: true 
    },
    window: { 
      type: String, 
      enum: ['1d', '3d', '7d', '14d'], 
      required: true,
      index: true 
    },
    
    // Counts
    total: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    neutral: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    
    // Metrics
    accuracy: { type: Number, default: 0 },
    confidenceWeightedAccuracy: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    
    // Timestamps
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
  },
  { 
    timestamps: true,
    collection: 'ml_accuracy_snapshots' 
  }
);

// Compound index for queries
AccuracySnapshotSchema.index({ network: 1, window: 1, createdAt: -1 });
AccuracySnapshotSchema.index({ modelVersion: 1, network: 1, window: 1, periodEnd: -1 });

export const AccuracySnapshotModel = mongoose.model<IAccuracySnapshot>(
  'AccuracySnapshot',
  AccuracySnapshotSchema
);

export default AccuracySnapshotModel;
