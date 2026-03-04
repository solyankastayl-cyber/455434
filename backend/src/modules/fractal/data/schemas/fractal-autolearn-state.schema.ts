/**
 * BLOCK 29.9: AutoLearn State Schema
 * Tracks degradation and active version for rollback logic
 */

import { Schema, model } from 'mongoose';

const FractalAutoLearnStateSchema = new Schema(
  {
    symbol: { type: String, required: true },

    lastRunAt: { type: Date },

    // Degradation tracking for auto-rollback
    consecutiveBad: { type: Number, default: 0 },

    // Current active version (for convenience)
    activeVersion: { type: String, default: 'ACTIVE' },

    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalAutoLearnStateSchema.index({ symbol: 1 }, { unique: true });

export const FractalAutoLearnStateModel = model('fractal_autolearn_state', FractalAutoLearnStateSchema);
