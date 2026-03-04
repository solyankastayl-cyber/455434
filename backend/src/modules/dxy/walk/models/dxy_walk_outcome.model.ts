/**
 * DXY WALK OUTCOME MODEL — A3.5
 * 
 * ISOLATION: DXY walk-forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_walk_outcomes
 * Unique index: (asOf, mode, horizonDays)
 */

import mongoose, { Schema } from 'mongoose';
import type { DxyWalkOutcome } from '../dxy-walk.types.js';

const DxyWalkOutcomeSchema = new Schema<DxyWalkOutcome>(
  {
    asOf: { type: Date, required: true, index: true },
    targetDate: { type: Date, required: true, index: true },
    mode: { type: String, required: true, enum: ['SYNTHETIC', 'HYBRID'], index: true },
    horizonDays: { type: Number, required: true, index: true },
    
    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number, default: null },
    actualReturn: { type: Number, default: null },
    
    hit: { type: Boolean, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'dxy_walk_outcomes' }
);

// Unique index for idempotent upserts
DxyWalkOutcomeSchema.index(
  { asOf: 1, mode: 1, horizonDays: 1 },
  { unique: true, name: 'uniq_dxy_walk_outcome' }
);

// Index for resolution queries
DxyWalkOutcomeSchema.index({ exitPrice: 1, targetDate: 1 });

export const DxyWalkOutcomeModel = 
  mongoose.models.DxyWalkOutcome ||
  mongoose.model<DxyWalkOutcome>('DxyWalkOutcome', DxyWalkOutcomeSchema);
