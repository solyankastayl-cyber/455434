/**
 * PHASE 2 — Timeline Event Model
 * ===============================
 * MongoDB storage for system events
 */

import mongoose, { Schema, Document } from 'mongoose';
import { TimelineEventType, Severity } from '../contracts/observability.types.js';

export interface ITimelineEvent extends Document {
  ts: Date;
  type: TimelineEventType;
  severity: Severity;
  symbol?: string;
  providerId?: string;
  message: string;
  data?: Record<string, any>;
}

const TimelineEventSchema = new Schema<ITimelineEvent>(
  {
    ts: { type: Date, required: true, index: true },
    type: { type: String, required: true, index: true },
    severity: { type: String, required: true },
    symbol: { type: String, index: true },
    providerId: { type: String, index: true },
    message: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
  },
  {
    collection: 'observability_timeline_events',
    timestamps: false,
  }
);

// Compound indexes for common queries
TimelineEventSchema.index({ ts: -1 });
TimelineEventSchema.index({ symbol: 1, ts: -1 });
TimelineEventSchema.index({ type: 1, ts: -1 });
TimelineEventSchema.index({ providerId: 1, ts: -1 });

export const TimelineEventModel = mongoose.models.TimelineEvent ||
  mongoose.model<ITimelineEvent>('TimelineEvent', TimelineEventSchema);

console.log('[Phase 2] Timeline Event Model loaded');
