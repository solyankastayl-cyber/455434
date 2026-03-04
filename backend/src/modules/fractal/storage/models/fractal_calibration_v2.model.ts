/**
 * BLOCK 43.1 — Fractal Calibration V2 Model
 * Stores Bayesian buckets (per modelKey / horizon / preset)
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICalibrationBucket {
  bucketKey: string;      // e.g. "0.30-0.35"
  n: number;
  wins: number;
  losses: number;
  postMean: number;
  ci90Low: number;
  ci90High: number;
  eceWeight?: number;
}

export interface IFractalCalibrationV2 extends Document {
  modelKey: string;       // e.g. "BTC:14" or "BTC:30"
  presetKey: string;      // e.g. "v2_entropy_final"
  horizonDays: number;
  similarityMode: string; // raw_returns / multi_rep
  buckets: ICalibrationBucket[];
  ece: number;
  brier: number;
  updatedAtTs: number;
  datasetHash?: string;
}

const BucketSchema = new Schema<ICalibrationBucket>(
  {
    bucketKey: { type: String, required: true },
    n: { type: Number, required: true },
    wins: { type: Number, required: true },
    losses: { type: Number, required: true },
    postMean: { type: Number, required: true },
    ci90Low: { type: Number, required: true },
    ci90High: { type: Number, required: true },
    eceWeight: { type: Number, default: 1 },
  },
  { _id: false }
);

const FractalCalibrationV2Schema = new Schema<IFractalCalibrationV2>(
  {
    modelKey: { type: String, required: true, index: true },
    presetKey: { type: String, required: true, index: true },
    horizonDays: { type: Number, required: true, index: true },
    similarityMode: { type: String, required: true },
    buckets: { type: [BucketSchema], required: true },
    ece: { type: Number, required: true },
    brier: { type: Number, required: true },
    updatedAtTs: { type: Number, required: true, index: true },
    datasetHash: { type: String },
  },
  { 
    versionKey: false,
    collection: 'fractal_calibration_v2'
  }
);

FractalCalibrationV2Schema.index(
  { modelKey: 1, presetKey: 1, horizonDays: 1 }, 
  { unique: true }
);

export const FractalCalibrationV2Model = mongoose.model<IFractalCalibrationV2>(
  'FractalCalibrationV2',
  FractalCalibrationV2Schema
);
