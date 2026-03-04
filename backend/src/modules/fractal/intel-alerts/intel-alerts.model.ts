/**
 * BLOCK 83 — Intel Alerts Model
 * 
 * MongoDB schema for Intelligence Event Alerts
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { IntelAlertEventType, IntelAlertSeverity, IntelAlertSource, IntelAlertPayload } from './intel-alerts.types.js';

interface IIntelEventAlert extends Document {
  date: string;
  symbol: string;
  source: IntelAlertSource;
  eventType: IntelAlertEventType;
  severity: IntelAlertSeverity;
  payload: IntelAlertPayload;
  sent: boolean;
  sentAt?: Date | null;
  rateKey: string;
}

const IntelEventAlertSchema = new Schema<IIntelEventAlert>({
  date: { type: String, required: true },
  symbol: { type: String, required: true },
  source: { type: String, required: true, enum: ['LIVE', 'V2014', 'V2020'] },
  eventType: { 
    type: String, 
    required: true, 
    enum: ['LOCK_ENTER', 'LOCK_EXIT', 'DOMINANCE_SHIFT', 'PHASE_DOWNGRADE'] 
  },
  severity: { 
    type: String, 
    required: true, 
    enum: ['INFO', 'WARN', 'CRITICAL'] 
  },
  payload: { type: Object, required: true },
  sent: { type: Boolean, default: false },
  sentAt: { type: Date, default: null },
  rateKey: { type: String, required: true },
}, { timestamps: true });

// Unique compound index for dedup
IntelEventAlertSchema.index({ symbol: 1, source: 1, date: 1, eventType: 1 }, { unique: true });

// For quota queries
IntelEventAlertSchema.index({ symbol: 1, source: 1, createdAt: -1 });

export const IntelEventAlertModel = mongoose.model<IIntelEventAlert>('IntelEventAlert', IntelEventAlertSchema);
export default IntelEventAlertModel;
