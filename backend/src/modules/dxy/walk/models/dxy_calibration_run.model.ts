/**
 * DXY Calibration Run Model
 * 
 * Collection: dxy_calibration_runs
 * Stores results of calibration grid runs
 */

import mongoose, { Schema } from 'mongoose';
import type { CalibrationRunDoc } from '../dxy-calibration-90d.types.js';

const GridConfigResultSchema = new Schema({
  configUsed: {
    windowLen: { type: Number, required: true },
    threshold: { type: Number, required: true },
    weightMode: { type: String, required: true },
    topK: { type: Number, required: true },
    focus: { type: String, required: true },
  },
  equityFinal: { type: Number, required: true },
  maxDD: { type: Number, required: true },
  hitRate: { type: Number, required: true },
  bias: { type: Number, required: true },
  actionableRate: { type: Number, required: true },
  trades: { type: Number, required: true },
  passed: { type: Boolean, required: true },
}, { _id: false });

const DxyCalibrationRunSchema = new Schema<CalibrationRunDoc>(
  {
    runId: { type: String, required: true, unique: true },
    runKey: { type: String, required: true, index: true },
    createdAt: { type: Date, required: true },
    focus: { type: String, required: true },
    oosFrom: { type: String, required: true },
    oosTo: { type: String, required: true },
    stepDays: { type: Number, required: true },
    gridConfig: {
      windowLen: [{ type: Number }],
      threshold: [{ type: Number }],
      weightMode: [{ type: String }],
      topK: { type: Number },
    },
    results: [GridConfigResultSchema],
    best: GridConfigResultSchema,
  },
  { timestamps: true, collection: 'dxy_calibration_runs' }
);

// Index for finding by runKey
DxyCalibrationRunSchema.index({ runKey: 1 }, { unique: true });

export const DxyCalibrationRunModel = 
  mongoose.models.DxyCalibrationRun ||
  mongoose.model<CalibrationRunDoc>('DxyCalibrationRun', DxyCalibrationRunSchema);
