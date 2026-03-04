/**
 * PHASE 4 - БЛОК 4.5: ML Readiness Gates
 * 
 * Hard blockers for Phase 5+ transitions
 * Gates must PASS before ML can influence Engine
 * 
 * Gates:
 * - DATASET: Sufficient samples + real labels
 * - CALIBRATION: ECE within threshold
 * - STABILITY: Agreement + flip rate healthy
 * - ALERTS: No critical/high alerts
 * - TEMPORAL: Minimum observation period
 */
import mongoose, { Schema, Document } from 'mongoose';

export type GateType = 'DATASET' | 'CALIBRATION' | 'STABILITY' | 'ALERTS' | 'TEMPORAL';
export type GateStatus = 'PASS' | 'FAIL';

export interface IMLReadinessGate extends Document {
  gate: GateType;
  status: GateStatus;
  blockingReason?: string;
  
  // Metrics that determined status
  metrics?: {
    sampleCount?: number;
    realLabelsRatio?: number;
    ece?: number;
    agreementRate?: number;
    flipRate?: number;
    criticalAlerts?: number;
    highAlerts?: number;
    observationHours?: number;
  };
  
  lastEvaluatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MLReadinessGateSchema = new Schema<IMLReadinessGate>(
  {
    gate: { 
      type: String, 
      required: true, 
      enum: ['DATASET', 'CALIBRATION', 'STABILITY', 'ALERTS', 'TEMPORAL'],
      unique: true,
      index: true,
    },
    status: { 
      type: String, 
      required: true, 
      enum: ['PASS', 'FAIL'],
      default: 'FAIL',
    },
    blockingReason: { type: String },
    
    metrics: {
      sampleCount: Number,
      realLabelsRatio: Number,
      ece: Number,
      agreementRate: Number,
      flipRate: Number,
      criticalAlerts: Number,
      highAlerts: Number,
      observationHours: Number,
    },
    
    lastEvaluatedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'ml_readiness_gates',
  }
);

export const MLReadinessGateModel = mongoose.model<IMLReadinessGate>(
  'MLReadinessGate',
  MLReadinessGateSchema
);
