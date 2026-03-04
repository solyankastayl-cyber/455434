/**
 * BLOCK 29.23 + 29.31-29.32: Feedback Events Schema
 * Stores settled outcomes for online learning + calibration
 */

import { Schema, model } from 'mongoose';

const FractalFeedbackSchema = new Schema(
  {
    symbol: { type: String, required: true },

    // BLOCK 29.32: Model key for horizon-specific tracking
    modelKey: { type: String }, // e.g. "BTC:30"

    // BLOCK 29.31: Horizon used for this trade
    horizonDays: { type: Number, default: 30 },

    // When was entry (feature snapshot time)
    openTs: { type: Date, required: true },
    // When settled (label time)
    settleTs: { type: Date, required: true },

    // Entry state
    side: { type: String, required: true },     // LONG | SHORT
    size: { type: Number, required: true },

    signal: { type: String, required: true },   // LONG | SHORT | NEUTRAL
    confidence: { type: Number, required: true },
    exposure: { type: Number, required: true },

    // Risk context at entry
    ddAbs: { type: Number, default: 0 },
    regime: {
      trend: String,
      volatility: String
    },

    // Features used by ML (matches featureOrder)
    features: { type: Schema.Types.Mixed, required: true },

    // Realized outcome
    realized: {
      openPrice: Number,
      closePrice: Number,
      gross: Number,
      net: Number
    },

    // Labels for training
    label: {
      y_up: Number,       // 1 if correct direction
      y_return: Number    // signed net return (direction-adjusted)
    },

    // Evaluation flags
    correct: { type: Boolean, default: false },

    // Model tracking
    modelVersion: { type: String, default: 'ACTIVE' },
    datasetHashAtTrain: String,

    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalFeedbackSchema.index({ symbol: 1, openTs: 1 }, { unique: true });
FractalFeedbackSchema.index({ symbol: 1, settleTs: -1 });
FractalFeedbackSchema.index({ modelKey: 1, settleTs: -1 });

export const FractalFeedbackModel = model('fractal_feedback', FractalFeedbackSchema);
