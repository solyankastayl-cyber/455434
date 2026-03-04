/**
 * OUTCOME MONGO MODEL
 * 
 * Block 1: Added healthState and healthSnapshot fields
 * to preserve model health context at forecast creation.
 */

import mongoose, { Schema } from "mongoose";

const OutcomeSchema = new Schema(
  {
    forecastId: { type: String, index: true, unique: true },
    verdictId: { type: String, index: true },
    symbol: { type: String, index: true },
    horizon: { type: String, index: true },

    entryTs: String,
    resolveAtTs: String,

    entryPrice: Number,
    exitPrice: Number,

    action: String,
    realizedReturn: Number,
    success: Boolean,
    maxDrawdown: Number,

    // Block 1: Health state at forecast creation time
    healthState: { type: String, enum: ["HEALTHY", "DEGRADED", "CRITICAL"] },
    healthSnapshot: {
      modifier: { type: Number },
      ece: { type: Number },
      divergence: { type: Number },
      criticalStreak: { type: Number },
      capturedAt: { type: String },
    },

    computedAt: { type: String, index: true },
  },
  { timestamps: true, collection: "evolution_outcomes" }
);

export const OutcomeModel = mongoose.models.EvolutionOutcome || mongoose.model("EvolutionOutcome", OutcomeSchema);

console.log('[Evolution] Outcome model loaded (Block 1: health fields)');
