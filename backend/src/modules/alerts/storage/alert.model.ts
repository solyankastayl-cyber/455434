/**
 * ALERTS MODULE — MongoDB Models
 */

import mongoose, { Schema, Document } from 'mongoose';
import { Alert, AlertSettings, DEFAULT_ALERT_SETTINGS } from '../contracts/alert.types.js';

// ═══════════════════════════════════════════════════════════════
// ALERT LOG MODEL
// ═══════════════════════════════════════════════════════════════

const AlertSchema = new Schema({
  alertId: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ['DECISION', 'RISK_WARNING', 'SYSTEM_DEGRADATION', 'RECOVERY'] },
  severity: { type: String, required: true, enum: ['INFO', 'WARNING', 'CRITICAL'] },
  channel: { type: String, required: true, enum: ['TELEGRAM', 'DISCORD', 'WEBHOOK'] },
  
  payload: { type: Schema.Types.Mixed, required: true },
  
  createdAt: { type: Number, required: true },
  sentAt: { type: Number },
  status: { type: String, required: true, enum: ['PENDING', 'SENT', 'FAILED', 'SKIPPED'] },
  error: { type: String },
  
  dedupeKey: { type: String, required: true, index: true },
}, {
  collection: 'alerts',
});

AlertSchema.index({ createdAt: -1 });
AlertSchema.index({ type: 1, createdAt: -1 });
AlertSchema.index({ status: 1 });

export const ProductAlertModel = mongoose.model<Alert & Document>('ProductAlert', AlertSchema);

// ═══════════════════════════════════════════════════════════════
// ALERT SETTINGS MODEL (singleton)
// ═══════════════════════════════════════════════════════════════

const AlertSettingsSchema = new Schema({
  _id: { type: String, default: 'alert_settings' },
  
  enabled: { type: Boolean, default: true },
  
  telegram: {
    enabled: { type: Boolean, default: false },
    botToken: { type: String },
    chatId: { type: String },
  },
  
  discord: {
    enabled: { type: Boolean, default: false },
    webhookUrl: { type: String },
  },
  
  decisionConfidenceThreshold: { type: Number, default: 0.65 },
  cooldownPerAssetMs: { type: Number, default: 30 * 60 * 1000 },
  cooldownPerEventMs: { type: Number, default: 10 * 60 * 1000 },
  
  channels: {
    decisions: { type: Boolean, default: true },
    riskWarnings: { type: Boolean, default: true },
    systemAlerts: { type: Boolean, default: true },
  },
  
  watchlist: [{ type: String }],
  
  updatedAt: { type: Number, default: Date.now },
}, {
  collection: 'alert_settings',
});

export const AlertSettingsModel = mongoose.model<AlertSettings & Document>('AlertSettings', AlertSettingsSchema);

// ═══════════════════════════════════════════════════════════════
// HELPER: Get or create settings
// ═══════════════════════════════════════════════════════════════

export async function getAlertSettings(): Promise<AlertSettings> {
  let settings = await AlertSettingsModel.findById('alert_settings').lean();
  
  if (!settings) {
    settings = await AlertSettingsModel.create({
      _id: 'alert_settings',
      ...DEFAULT_ALERT_SETTINGS,
    });
  }
  
  return settings as AlertSettings;
}

export async function updateAlertSettings(update: Partial<AlertSettings>): Promise<AlertSettings> {
  const settings = await AlertSettingsModel.findByIdAndUpdate(
    'alert_settings',
    { $set: { ...update, updatedAt: Date.now() } },
    { new: true, upsert: true }
  ).lean();
  
  return settings as AlertSettings;
}
