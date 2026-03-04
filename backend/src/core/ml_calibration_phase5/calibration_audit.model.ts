/**
 * Phase 5: Auto-Calibration
 * ml_calibration_audit collection
 * Logs every application of calibration on sample level
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICalibrationAudit extends Document {
  ts: Date;
  window: '24h' | '7d';
  sampleKey: string;
  rawConfidence: number;
  calibratedConfidence: number;
  adjPct: number;
  clamped: boolean;
  mapId: string;
  runId: string;
}

const CalibrationAuditSchema = new Schema<ICalibrationAudit>({
  ts: { type: Date, required: true, default: Date.now, index: true },
  window: { type: String, required: true, enum: ['24h', '7d'] },
  sampleKey: { type: String, required: true, index: true },
  rawConfidence: { type: Number, required: true },
  calibratedConfidence: { type: Number, required: true },
  adjPct: { type: Number, required: true },
  clamped: { type: Boolean, required: true },
  mapId: { type: String, required: true },
  runId: { type: String, required: true },
});

// Indexes for efficient queries
CalibrationAuditSchema.index({ ts: -1 });
CalibrationAuditSchema.index({ sampleKey: 1 });
CalibrationAuditSchema.index({ window: 1, ts: -1 });

export const CalibrationAuditModel = mongoose.model<ICalibrationAudit>(
  'CalibrationAudit',
  CalibrationAuditSchema,
  'ml_calibration_audit'
);
