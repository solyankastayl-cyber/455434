/**
 * BLOCK 29.23: Online Calibration Buckets Schema
 * Tracks empirical accuracy per confidence bucket for live calibration
 */

import { Schema, model } from 'mongoose';

const BucketSchema = new Schema(
  {
    lo: Number,
    hi: Number,
    n: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    sumNet: { type: Number, default: 0 }
  },
  { _id: false }
);

const FractalOnlineCalibrationSchema = new Schema(
  {
    symbol: { type: String, required: true },
    buckets: { type: [BucketSchema], default: [] },
    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalOnlineCalibrationSchema.index({ symbol: 1 }, { unique: true });

export const FractalOnlineCalibrationModel = model('fractal_online_calibration', FractalOnlineCalibrationSchema);
