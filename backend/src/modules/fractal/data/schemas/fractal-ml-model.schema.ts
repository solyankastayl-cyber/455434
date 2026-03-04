/**
 * BLOCK 27 + 29.13: ML Model Schema
 * Stores trained model weights in MongoDB (with scaler support)
 */

import { Schema, model } from 'mongoose';

const FractalMLModelSchema = new Schema(
  {
    symbol: { type: String, required: true },
    version: { type: String, required: true },
    type: { type: String, required: true }, // "logreg", "logreg_scaled", "xgboost"

    // LogisticRegression weights (in scaled space if scaler present)
    weights: [Number],
    bias: { type: Number },
    featureOrder: [String],

    // BLOCK 29.13: Scaler parameters (for logreg_scaled)
    scaler: {
      mean: [Number],
      scale: [Number]
    },

    // Training metadata
    trainStats: {
      samples: { type: Number },
      accuracy: { type: Number },
      auc: { type: Number },
      trainDate: { type: Date }
    },

    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalMLModelSchema.index({ symbol: 1, version: 1 }, { unique: true });

export const FractalMLModel = model('fractal_ml_model', FractalMLModelSchema);
