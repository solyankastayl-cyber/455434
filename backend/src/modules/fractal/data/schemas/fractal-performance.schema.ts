/**
 * BLOCK 20+25: Fractal Performance Schema
 * Tracks "pattern worked / didn't work" for self-learning
 */

import { Schema, model } from 'mongoose';

const FractalPerfSchema = new Schema(
  {
    symbol: { type: String, required: true },
    timeframe: { type: String, required: true },
    windowLen: { type: Number, required: true },
    horizonDays: { type: Number, required: true },

    windowEndTs: { type: Date, required: true },

    // What fractal implied
    implied: {
      direction: { type: String, required: true }, // "UP" | "DOWN" | "MIXED"
      p50Return: { type: Number, required: true },
      p10Return: { type: Number, required: true },
      p90Return: { type: Number, required: true }
    },

    // What actually happened
    realized: {
      forwardReturn: { type: Number, required: true },
      forwardMaxDD: { type: Number, required: true }
    },

    // BLOCK 25: Confidence metrics for calibration
    confidence: {
      effectiveSampleSize: { type: Number },
      regimeConsistency: { type: Number },
      rawScore: { type: Number }
    },

    // Evaluation
    hit: { type: Boolean, required: true },
    errorAbs: { type: Number, required: true },

    createdAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalPerfSchema.index(
  { symbol: 1, timeframe: 1, windowLen: 1, horizonDays: 1, windowEndTs: 1 },
  { unique: true }
);

FractalPerfSchema.index({ symbol: 1, windowEndTs: -1 });

export const FractalPerfModel = model('fractal_performance', FractalPerfSchema);
