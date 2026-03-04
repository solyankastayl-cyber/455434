/**
 * ML Drift Events Model - ML v2.1 STEP 2
 * 
 * Stores drift detection events when accuracy degrades.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// TYPES
// ============================================

export type DriftSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type DriftAction = 'NONE' | 'RETRAIN' | 'DISABLE';

export interface IDriftEvent extends Document {
  modelVersion: string;
  network: string;
  horizon: string;
  
  // Comparison
  metric: string;
  baselineWindow: string;
  currentWindow: string;
  baselineValue: number;
  currentValue: number;
  delta: number;
  
  // Severity
  severity: DriftSeverity;
  actionSuggested: DriftAction;
  actionTaken: DriftAction;
  
  // Status
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  
  createdAt: Date;
}

// ============================================
// SCHEMA
// ============================================

const DriftEventSchema = new Schema<IDriftEvent>(
  {
    modelVersion: { type: String, required: true, index: true },
    network: { type: String, required: true, index: true },
    horizon: { type: String, default: '4h' },
    
    // Comparison
    metric: { type: String, default: 'accuracy' },
    baselineWindow: { type: String, default: '7d' },
    currentWindow: { type: String, default: '1d' },
    baselineValue: { type: Number, required: true },
    currentValue: { type: Number, required: true },
    delta: { type: Number, required: true },
    
    // Severity
    severity: { 
      type: String, 
      enum: ['LOW', 'MEDIUM', 'HIGH'], 
      required: true,
      index: true 
    },
    actionSuggested: { 
      type: String, 
      enum: ['NONE', 'RETRAIN', 'DISABLE'], 
      default: 'NONE' 
    },
    actionTaken: { 
      type: String, 
      enum: ['NONE', 'RETRAIN', 'DISABLE'], 
      default: 'NONE' 
    },
    
    // Status
    acknowledged: { type: Boolean, default: false },
    acknowledgedBy: { type: String, default: null },
    acknowledgedAt: { type: Date, default: null },
  },
  { 
    timestamps: true,
    collection: 'ml_drift_events' 
  }
);

// Index for recent unacknowledged events
DriftEventSchema.index({ acknowledged: 1, severity: 1, createdAt: -1 });

export const DriftEventModel = mongoose.model<IDriftEvent>(
  'DriftEvent',
  DriftEventSchema
);

export default DriftEventModel;
