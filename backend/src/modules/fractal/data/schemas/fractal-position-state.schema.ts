/**
 * BLOCK 29.20: Position State Schema
 * Tracks position lifecycle (FLAT/LONG/SHORT), cooldown, pending settle
 */

import { Schema, model } from 'mongoose';

const FractalPositionStateSchema = new Schema(
  {
    symbol: { type: String, required: true },

    // Current position state
    side: { type: String, default: 'FLAT' },  // FLAT | LONG | SHORT
    size: { type: Number, default: 0 },        // 0..maxLev (final exposure)
    entryTs: Date,
    entryPrice: Number,

    lastSignalTs: Date,

    // Cooldown (for cost-aware flip and exit discipline)
    coolDownUntil: Date,

    // PnL tracking
    unrealized: { type: Number, default: 0 },
    realized: { type: Number, default: 0 },

    // BLOCK 29.21: Pending settle (horizon-based close)
    pending: {
      horizonDays: { type: Number, default: 30 },
      openTs: Date,
      openIdx: Number,
      openPrice: Number,
      side: String,
      size: Number,
      // BLOCK 29.23: Feature snapshot for feedback loop
      features: { type: Schema.Types.Mixed },
      confidence: Number,
      signal: String,
      modelVersion: String,
      regime: {
        trend: String,
        volatility: String
      },
      ddAbs: Number,
      datasetHashAtTrain: String
    },

    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalPositionStateSchema.index({ symbol: 1 }, { unique: true });

export const FractalPositionStateModel = model('fractal_position_state', FractalPositionStateSchema);
