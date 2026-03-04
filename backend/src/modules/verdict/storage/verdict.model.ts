/**
 * VERDICT MONGO MODEL
 */

import mongoose, { Schema } from "mongoose";

const VerdictSchema = new Schema(
  {
    verdictId: { type: String, index: true, unique: true },
    symbol: { type: String, index: true },
    ts: { type: String, index: true },

    horizon: { type: String },
    action: { type: String },

    expectedReturn: { type: Number },
    confidence: { type: Number },
    risk: { type: String },

    positionSizePct: { type: Number },

    raw: {
      expectedReturn: Number,
      confidence: Number,
      horizon: String,
      modelId: String,
    },

    adjustments: { type: Array, default: [] },
    appliedRules: { type: Array, default: [] },

    modelId: { type: String, index: true },
    regime: { type: String, index: true },

    status: { type: String, default: "OPEN", index: true }, // OPEN|CLOSED|INVALIDATED
  },
  { timestamps: true, collection: "verdicts" }
);

export const VerdictModel = mongoose.models.Verdict || mongoose.model("Verdict", VerdictSchema);

console.log('[Verdict] Model loaded');
