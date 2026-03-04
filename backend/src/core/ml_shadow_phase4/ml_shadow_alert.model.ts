/**
 * PHASE 4 - БЛОК 4.5: Shadow ML Alerts
 * ml_shadow_alerts collection (PASSIVE + GATING)
 * 
 * Internal alerts for drift, degradation, anomalies
 * NOT sent to users - internal monitoring only
 * Used for Phase 5 readiness gating
 */
import mongoose, { Schema, Document } from 'mongoose';

export type ShadowAlertType = 'DRIFT' | 'DEGRADATION' | 'ANOMALY' | 'DATA_GAP';
export type ShadowAlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ShadowAlertStatus = 'OPEN' | 'ACKED' | 'RESOLVED';

export interface IMLShadowAlert extends Document {
  alertId: string;
  type: ShadowAlertType;
  severity: ShadowAlertSeverity;
  status: ShadowAlertStatus;
  
  // Metrics context
  metric: string;
  currentValue: number;
  baselineValue?: number;
  threshold: number;
  
  // Context
  window?: string;
  runId?: string;
  
  // Status tracking
  firstSeenAt: Date;
  lastSeenAt: Date;
  
  // Resolution
  resolutionReason?: string;
  resolvedAt?: Date;
  
  // Original message
  message: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const MLShadowAlertSchema = new Schema<IMLShadowAlert>(
  {
    alertId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, enum: ['DRIFT', 'DEGRADATION', 'ANOMALY', 'DATA_GAP'] },
    severity: { type: String, required: true, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    status: { type: String, required: true, enum: ['OPEN', 'ACKED', 'RESOLVED'], default: 'OPEN' },
    
    metric: { type: String, required: true },
    currentValue: { type: Number, required: true },
    baselineValue: { type: Number },
    threshold: { type: Number, required: true },
    
    window: { type: String },
    runId: { type: String, index: true },
    
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
    
    resolutionReason: { type: String },
    resolvedAt: { type: Date },
    
    message: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'ml_shadow_alerts',
  }
);

// Indexes
MLShadowAlertSchema.index({ type: 1, severity: 1 });
MLShadowAlertSchema.index({ status: 1 });
MLShadowAlertSchema.index({ firstSeenAt: -1 });

export const MLShadowAlertModel = mongoose.model<IMLShadowAlert>('MLShadowAlert', MLShadowAlertSchema);
