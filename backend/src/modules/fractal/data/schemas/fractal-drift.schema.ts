/**
 * BLOCK 29.24: Drift Detection Schema
 * Logs drift events and recommended actions
 */

import { Schema, model } from 'mongoose';

const FractalDriftSchema = new Schema(
  {
    symbol: { type: String, required: true },
    ts: { type: Date, required: true },

    window: {
      recentN: Number,
      baselineN: Number,
      recentFrom: Date,
      recentTo: Date
    },

    metrics: {
      recentAcc: Number,
      baselineAcc: Number,
      accDelta: Number,

      recentMeanNet: Number,
      baselineMeanNet: Number,
      netDelta: Number,

      recentHitRate: Number,
      baselineHitRate: Number,

      highConfAccRecent: Number,
      highConfAccBaseline: Number
    },

    drift: {
      level: { type: String, enum: ['OK', 'WARN', 'DEGRADED', 'CRITICAL'] },
      reasons: [String]
    },

    action: {
      recommended: { type: String, enum: ['NONE', 'RETRAIN', 'ROLLBACK', 'FREEZE_PROMOTION'] },
      details: { type: Schema.Types.Mixed }
    }
  },
  { versionKey: false }
);

FractalDriftSchema.index({ symbol: 1, ts: -1 });

export const FractalDriftModel = model('fractal_drift', FractalDriftSchema);
