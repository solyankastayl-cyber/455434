/**
 * DXY WALK METRICS MODEL — A3.5
 * 
 * ISOLATION: DXY walk-forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_walk_metrics
 * Unique index: (mode, horizonDays, from, to)
 */

import mongoose, { Schema } from 'mongoose';
import type { DxyWalkMetrics } from '../dxy-walk.types.js';

const DxyWalkMetricsSchema = new Schema<DxyWalkMetrics>(
  {
    mode: { type: String, required: true, enum: ['SYNTHETIC', 'HYBRID'], index: true },
    horizonDays: { type: Number, required: true, index: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    
    samples: { type: Number, required: true },
    actionable: { type: Number, required: true },
    hitRate: { type: Number, required: true },
    avgReturn: { type: Number, required: true },
    avgPredictedReturn: { type: Number, required: true },
    bias: { type: Number, required: true },
    
    avgReplayWeight: { type: Number, required: true },
    replayWeightStd: { type: Number, required: true },
    
    computedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: 'dxy_walk_metrics' }
);

// Unique index for aggregated metrics
DxyWalkMetricsSchema.index(
  { mode: 1, horizonDays: 1, from: 1, to: 1 },
  { unique: true, name: 'uniq_dxy_walk_metrics' }
);

export const DxyWalkMetricsModel = 
  mongoose.models.DxyWalkMetrics ||
  mongoose.model<DxyWalkMetrics>('DxyWalkMetrics', DxyWalkMetricsSchema);
