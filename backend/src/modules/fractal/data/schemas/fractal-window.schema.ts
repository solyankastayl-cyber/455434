/**
 * BLOCK 16: Fractal Window Schema
 * ML-ready dataset: Features (X) + Labels (y)
 */

import { Schema, model } from 'mongoose';

const FractalWindowSchema = new Schema(
  {
    meta: {
      symbol: { type: String, required: true },     // "BTC"
      timeframe: { type: String, required: true },  // "1d"
      windowLen: { type: Number, required: true },  // 30/60/90
      horizonDays: { type: Number, required: true } // 30
    },

    windowEndTs: { type: Date, required: true },

    features: {
      // Shape features
      meanLogRet: { type: Number, required: true },
      volLogRet: { type: Number, required: true },
      skewLogRet: { type: Number, required: true },
      kurtLogRet: { type: Number, required: true },
      slope90: { type: Number, required: true },
      maxDrawdownInWindow: { type: Number, required: true },

      // Context features
      avgQuality: { type: Number, required: true },
      regimeVol: { type: Number, required: true },     // 0/1/2 (LOW/NORMAL/HIGH)
      regimeTrend: { type: Number, required: true },   // -1/0/1 (DOWN/SIDEWAYS/UP)

      // Match quality features
      topMatchScore: { type: Number, required: true },
      avgTopKScore: { type: Number, required: true },
      regimeConsistency: { type: Number, required: true },
      effectiveSampleSize: { type: Number, required: true }
    },

    // Prediction snapshot (what fractal predicted at time of match)
    prediction: {
      p10Return: { type: Number },
      p50Return: { type: Number },
      p90Return: { type: Number },
      p10MaxDD: { type: Number },
      p50MaxDD: { type: Number },
      p90MaxDD: { type: Number }
    },

    // Label (filled after horizon passes)
    label: {
      ready: { type: Boolean, default: false },
      horizonEndTs: { type: Date },
      forwardReturn: { type: Number },
      forwardMaxDD: { type: Number },
      forwardVol: { type: Number }
    },

    // Debug info
    debug: {
      bestMatch: {
        startTs: { type: Date },
        endTs: { type: Date },
        score: { type: Number },
        windowQuality: { type: Number },
        regimeMatchScore: { type: Number }
      }
    },

    createdAt: { type: Date, default: Date.now },
    lastCheckedAt: { type: Date }
  },
  { versionKey: false }
);

// Unique constraint: one record per (symbol, timeframe, windowLen, horizonDays, windowEndTs)
FractalWindowSchema.index(
  { 'meta.symbol': 1, 'meta.timeframe': 1, 'meta.windowLen': 1, 'meta.horizonDays': 1, windowEndTs: 1 },
  { unique: true }
);

// Index for label resolution job
FractalWindowSchema.index({ 'label.ready': 1, windowEndTs: 1 });

export const FractalWindowModel = model('fractal_window', FractalWindowSchema);
