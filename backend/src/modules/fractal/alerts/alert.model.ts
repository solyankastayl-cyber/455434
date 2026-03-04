/**
 * BLOCK 67 — Alert Log Model (MongoDB)
 * 
 * Stores all alert events (sent and blocked).
 * Enables audit trail and quota tracking.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import type { AlertType, AlertLevel, AlertBlockedBy } from './alert.types.js';

export interface IAlertLog extends Document {
  symbol: 'BTC';
  type: AlertType;
  level: AlertLevel;
  message: string;
  fingerprint: string;
  meta: Record<string, any>;
  blockedBy: AlertBlockedBy;
  triggeredAt: Date;
  createdAt: Date;
}

const AlertLogSchema = new Schema<IAlertLog>({
  symbol: {
    type: String,
    enum: ['BTC'],
    required: true,
    default: 'BTC'
  },
  type: {
    type: String,
    enum: ['REGIME_SHIFT', 'CRISIS_ENTER', 'CRISIS_EXIT', 'HEALTH_DROP', 'TAIL_SPIKE'],
    required: true
  },
  level: {
    type: String,
    enum: ['INFO', 'HIGH', 'CRITICAL'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  fingerprint: {
    type: String,
    required: true
  },
  meta: {
    type: Schema.Types.Mixed,
    default: {}
  },
  blockedBy: {
    type: String,
    enum: ['NONE', 'DEDUP', 'QUOTA', 'COOLDOWN', 'BATCH_SUPPRESSED'],
    default: 'NONE'
  },
  triggeredAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'fractal_alerts_log'
});

// Indexes for efficient queries
AlertLogSchema.index({ triggeredAt: -1 });
AlertLogSchema.index({ fingerprint: 1, triggeredAt: -1 });
AlertLogSchema.index({ level: 1, triggeredAt: -1 });
AlertLogSchema.index({ symbol: 1, type: 1, triggeredAt: -1 });
AlertLogSchema.index({ blockedBy: 1, triggeredAt: -1 });

export const AlertLogModel: Model<IAlertLog> = mongoose.models.FractalAlertLog ||
  mongoose.model<IAlertLog>('FractalAlertLog', AlertLogSchema);
