/**
 * DXY WALK SIGNAL MODEL — A3.5
 * 
 * ISOLATION: DXY walk-forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_walk_signals
 * Unique index: (asOf, mode, horizonDays, windowLen, topK, threshold)
 */

import mongoose, { Schema } from 'mongoose';
import type { DxyWalkSignal } from '../dxy-walk.types.js';

const DxyWalkSignalSchema = new Schema<DxyWalkSignal>(
  {
    asOf: { type: Date, required: true, index: true },
    mode: { type: String, required: true, enum: ['SYNTHETIC', 'HYBRID'], index: true },
    horizonDays: { type: Number, required: true, index: true },
    windowLen: { type: Number, required: true },
    topK: { type: Number, required: true },
    threshold: { type: Number, required: true },
    
    currentPrice: { type: Number, required: true },
    predictedReturn: { type: Number, required: true },
    predictedDirection: { type: String, required: true, enum: ['UP', 'DOWN', 'FLAT'] },
    
    similarity: { type: Number, required: true, min: 0, max: 1 },
    entropy: { type: Number, required: true, min: 0, max: 1 },
    replayWeight: { type: Number, required: true, min: 0, max: 1 },
    
    matchDate: { type: Date, default: null },
  },
  { timestamps: true, collection: 'dxy_walk_signals' }
);

// Unique index for idempotent upserts
DxyWalkSignalSchema.index(
  { asOf: 1, mode: 1, horizonDays: 1, windowLen: 1, topK: 1, threshold: 1 },
  { unique: true, name: 'uniq_dxy_walk_signal' }
);

export const DxyWalkSignalModel = 
  mongoose.models.DxyWalkSignal ||
  mongoose.model<DxyWalkSignal>('DxyWalkSignal', DxyWalkSignalSchema);
