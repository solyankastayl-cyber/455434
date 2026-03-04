/**
 * BLOCK 80.2 — Drift Alert History Model
 * 
 * Stores drift alerts for rate limiting and audit.
 */

import mongoose from 'mongoose';

const DriftAlertSchema = new mongoose.Schema(
  {
    alertId: { type: String, unique: true, required: true, index: true },
    symbol: { type: String, required: true },
    severity: { type: String, required: true, enum: ['WATCH', 'WARN', 'CRITICAL'] },
    previousSeverity: { type: String },
    
    metrics: {
      deltaSharpe: { type: Number },
      deltaHitRate: { type: Number },
      calibrationError: { type: Number },
      liveSamples: { type: Number },
    },
    
    comparison: {
      pair: { type: String }, // LIVE_V2020, LIVE_V2014
      cohortA: { type: String },
      cohortB: { type: String },
    },
    
    triggeredAt: { type: Date, required: true },
    sentToTelegram: { type: Boolean, default: false },
    telegramMessageId: { type: String },
    
    // Rate limiting
    cooldownUntil: { type: Date },
    wasRateLimited: { type: Boolean, default: false },
    
    // Context
    governanceLocked: { type: Boolean },
    recommendation: { type: String },
  },
  { 
    timestamps: true,
    collection: 'drift_alerts'
  }
);

DriftAlertSchema.index({ triggeredAt: -1 });
DriftAlertSchema.index({ severity: 1, triggeredAt: -1 });
DriftAlertSchema.index({ symbol: 1, severity: 1, triggeredAt: -1 });

export const DriftAlertModel = mongoose.model('DriftAlert', DriftAlertSchema);

export default DriftAlertModel;
