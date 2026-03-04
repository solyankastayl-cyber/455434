/**
 * Phase 5: Auto-Calibration
 * ml_calibration_runs collection
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICalibrationRun extends Document {
  runId: string;
  createdAt: Date;
  window: '24h' | '7d';
  sampleRange: {
    from: Date;
    to: Date;
    count: number;
    realLabelPct: number;
  };
  strataSummary: {
    low: number;
    medium: number;
    high: number;
  };
  inputMetrics: {
    eceBefore: number;
    agreementRate: number;
    flipRate: number;
    accuracy: number;
  };
  outputMetrics: {
    eceAfter: number;
    deltaECE: number;
    clampRate: number;
    maxAdjSeen: number;
  };
  status: 'DRAFT' | 'SIMULATED' | 'APPLIED' | 'REJECTED';
  rejectionReasons: string[];
  config: {
    bins: number;
    maxAdjPct: number;
    minBinCount: number;
    smoothing: 'isotonic-lite' | 'beta' | 'histogram';
  };
  artifactsRef: {
    mapId?: string;
    sampleKeys?: string[];
  };
}

const CalibrationRunSchema = new Schema<ICalibrationRun>({
  runId: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, required: true, default: Date.now, index: true },
  window: { type: String, required: true, enum: ['24h', '7d'], index: true },
  sampleRange: {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    count: { type: Number, required: true },
    realLabelPct: { type: Number, required: true },
  },
  strataSummary: {
    low: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    high: { type: Number, default: 0 },
  },
  inputMetrics: {
    eceBefore: { type: Number, required: true },
    agreementRate: { type: Number, required: true },
    flipRate: { type: Number, required: true },
    accuracy: { type: Number, required: true },
  },
  outputMetrics: {
    eceAfter: { type: Number, required: true },
    deltaECE: { type: Number, required: true },
    clampRate: { type: Number, required: true },
    maxAdjSeen: { type: Number, required: true },
  },
  status: {
    type: String,
    required: true,
    enum: ['DRAFT', 'SIMULATED', 'APPLIED', 'REJECTED'],
    default: 'DRAFT',
    index: true,
  },
  rejectionReasons: [{ type: String }],
  config: {
    bins: { type: Number, required: true, default: 10 },
    maxAdjPct: { type: Number, required: true, default: 10 },
    minBinCount: { type: Number, required: true, default: 20 },
    smoothing: {
      type: String,
      required: true,
      enum: ['isotonic-lite', 'beta', 'histogram'],
      default: 'histogram',
    },
  },
  artifactsRef: {
    mapId: { type: String },
    sampleKeys: [{ type: String }],
  },
});

// Compound indexes
CalibrationRunSchema.index({ window: 1, createdAt: -1 });
CalibrationRunSchema.index({ status: 1, createdAt: -1 });

export const CalibrationRunModel = mongoose.model<ICalibrationRun>(
  'CalibrationRun',
  CalibrationRunSchema,
  'ml_calibration_runs'
);
