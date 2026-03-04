/**
 * CREDIBILITY MONGO MODEL
 */

import mongoose, { Schema } from "mongoose";

const CredSchema = new Schema(
  {
    keyHash: { type: String, index: true, unique: true },
    kind: { type: String, index: true },

    symbol: { type: String, index: true },
    modelId: { type: String, index: true },
    horizon: { type: String, index: true },
    regime: { type: String, index: true },

    n: { type: Number, default: 0 },
    emaScore: { type: Number, default: 0.5 },
    emaReturn: { type: Number, default: 0.0 },
    emaDrawdown: { type: Number, default: 0.0 },

    updatedAt: { type: String, index: true },
  },
  { timestamps: true, collection: "credibility_states" }
);

export const CredibilityModel =
  mongoose.models.CredibilityState || mongoose.model("CredibilityState", CredSchema);

console.log('[Evolution] Credibility model loaded');
