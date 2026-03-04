/**
 * Phase 5: Auto-Calibration
 * ml_calibration_maps collection
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICalibrationBin {
  bin: string; // e.g., "0.5-0.6"
  n: number;
  meanConf: number;
  meanAcc: number;
  adjPct: number;
  adjClamped: boolean;
}

export interface ICalibrationMap extends Document {
  mapId: string;
  runId: string;
  window: '24h' | '7d';
  scope: 'GLOBAL' | 'BY_STRATUM' | 'BY_SEVERITY' | 'BY_STRATUM_SEVERITY';
  bins: ICalibrationBin[];
  smoothingMeta: {
    method: string;
    params: Record<string, any>;
  };
  guardrails: {
    maxAdjPct: number;
    minBinCount: number;
  };
  createdAt: Date;
}

const CalibrationBinSchema = new Schema<ICalibrationBin>({
  bin: { type: String, required: true },
  n: { type: Number, required: true },
  meanConf: { type: Number, required: true },
  meanAcc: { type: Number, required: true },
  adjPct: { type: Number, required: true },
  adjClamped: { type: Boolean, required: true },
}, { _id: false });

const CalibrationMapSchema = new Schema<ICalibrationMap>({
  mapId: { type: String, required: true, unique: true, index: true },
  runId: { type: String, required: true, index: true },
  window: { type: String, required: true, enum: ['24h', '7d'], index: true },
  scope: {
    type: String,
    required: true,
    enum: ['GLOBAL', 'BY_STRATUM', 'BY_SEVERITY', 'BY_STRATUM_SEVERITY'],
  },
  bins: [CalibrationBinSchema],
  smoothingMeta: {
    method: { type: String, required: true },
    params: { type: Schema.Types.Mixed, required: true },
  },
  guardrails: {
    maxAdjPct: { type: Number, required: true, default: 10 },
    minBinCount: { type: Number, required: true, default: 20 },
  },
  createdAt: { type: Date, required: true, default: Date.now, index: true },
});

// Compound index
CalibrationMapSchema.index({ window: 1, createdAt: -1 });

export const CalibrationMapModel = mongoose.model<ICalibrationMap>(
  'CalibrationMap',
  CalibrationMapSchema,
  'ml_calibration_maps'
);
