/**
 * FOMO Alert Config Model
 */

import mongoose, { Schema, Document } from 'mongoose';
import { FomoAlertConfig, FomoAlertLog, DEFAULT_FOMO_ALERT_CONFIG } from '../contracts/fomo-alert.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG MODEL (Singleton)
// ═══════════════════════════════════════════════════════════════

const FomoAlertConfigSchema = new Schema({
  _id: { type: String, default: 'fomo_alert_config' },
  
  enabled: { type: Boolean, default: true },
  
  user: {
    enabled: { type: Boolean, default: true },
    botToken: String,
    chatId: String,
    
    decisionChanged: { type: Boolean, default: true },
    highConfidence: { type: Boolean, default: true },
    riskIncreased: { type: Boolean, default: true },
    
    confidenceThreshold: { type: Number, default: 0.65 },
    symbols: [String],
    cooldownMs: { type: Number, default: 15 * 60 * 1000 },
  },
  
  admin: {
    enabled: { type: Boolean, default: true },
    botToken: String,
    chatId: String,
    
    mlPromoted: { type: Boolean, default: true },
    mlRollback: { type: Boolean, default: true },
    mlShadowCritical: { type: Boolean, default: true },
    providerDown: { type: Boolean, default: true },
    wsDisconnect: { type: Boolean, default: true },
    dataCompleteness: { type: Boolean, default: true },
    trustWarning: { type: Boolean, default: true },
    
    minSeverity: { type: String, default: 'WARNING', enum: ['INFO', 'WARNING', 'CRITICAL'] },
    cooldownMs: { type: Number, default: 10 * 60 * 1000 },
  },
  
  global: {
    requireLiveData: { type: Boolean, default: true },
    requireMlReady: { type: Boolean, default: false },
    noUserAlertsOnAvoid: { type: Boolean, default: true },
    maxAlertsPerHour: { type: Number, default: 50 },
    dedupeWindowMs: { type: Number, default: 10 * 60 * 1000 },
  },
  
  updatedAt: { type: Number, default: Date.now },
}, {
  collection: 'fomo_alert_config',
});

export const FomoAlertConfigModel = mongoose.model<FomoAlertConfig & Document>(
  'FomoAlertConfig',
  FomoAlertConfigSchema
);

// ═══════════════════════════════════════════════════════════════
// ALERT LOG MODEL
// ═══════════════════════════════════════════════════════════════

const FomoAlertLogSchema = new Schema({
  alertId: { type: String, required: true, unique: true, index: true },
  event: { type: String, required: true, index: true },
  scope: { type: String, required: true, enum: ['USER', 'ADMIN'] },
  
  payload: Schema.Types.Mixed,
  message: String,
  
  status: { 
    type: String, 
    required: true, 
    enum: ['SENT', 'SKIPPED', 'MUTED', 'DEDUPED', 'FAILED', 'GUARD_BLOCKED'],
    index: true,
  },
  skipReason: String,
  
  createdAt: { type: Number, required: true, index: true },
  sentAt: Number,
  
  outcome: {
    confirmed: Boolean,
    evaluatedAt: Number,
  },
}, {
  collection: 'fomo_alert_logs',
});

FomoAlertLogSchema.index({ createdAt: -1 });
FomoAlertLogSchema.index({ event: 1, createdAt: -1 });

export const FomoAlertLogModel = mongoose.model<FomoAlertLog & Document>(
  'FomoAlertLog',
  FomoAlertLogSchema
);

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export async function getFomoAlertConfig(): Promise<FomoAlertConfig> {
  let config = await FomoAlertConfigModel.findById('fomo_alert_config').lean();
  
  if (!config) {
    config = await FomoAlertConfigModel.create({
      _id: 'fomo_alert_config',
      ...DEFAULT_FOMO_ALERT_CONFIG,
    });
  }
  
  return config as FomoAlertConfig;
}

export async function updateFomoAlertConfig(update: Partial<FomoAlertConfig>): Promise<FomoAlertConfig> {
  const config = await FomoAlertConfigModel.findByIdAndUpdate(
    'fomo_alert_config',
    { $set: { ...update, updatedAt: Date.now() } },
    { new: true, upsert: true }
  ).lean();
  
  return config as FomoAlertConfig;
}
