/**
 * SPX MEMORY LAYER — Outcome Model
 * 
 * BLOCK B6.1 — MongoDB model for SPX outcomes
 * 
 * Collection: spx_outcomes (isolated from btc_outcomes)
 */

import mongoose, { Schema, model } from 'mongoose';
import type { SpxOutcomeDoc } from './spx-memory.types.js';

const { models } = mongoose;

const SpxOutcomeSchema = new Schema<SpxOutcomeDoc>(
  {
    snapshotId: { 
      type: String, 
      required: true, 
      index: true 
    },
    symbol: { 
      type: String, 
      enum: ['SPX'], 
      required: true, 
      default: 'SPX', 
      index: true 
    },
    source: { 
      type: String, 
      required: true, 
      index: true 
    },
    preset: { 
      type: String, 
      required: true, 
      index: true 
    },

    asOfDate: { 
      type: String, 
      required: true, 
      index: true 
    },
    horizon: { 
      type: String, 
      required: true, 
      index: true 
    },

    resolvedDate: { 
      type: String, 
      required: true, 
      index: true 
    },
    entryClose: { 
      type: Number, 
      required: true 
    },
    exitClose: { 
      type: Number, 
      required: true 
    },

    actualReturnPct: { 
      type: Number, 
      required: true 
    },
    expectedDirection: { 
      type: String, 
      required: true 
    },
    hit: { 
      type: Boolean, 
      required: true 
    },
  },
  { 
    timestamps: true,
    collection: 'spx_outcomes',
  }
);

// One outcome per snapshot (idempotency)
SpxOutcomeSchema.index(
  { snapshotId: 1 },
  { unique: true, name: 'spx_outcome_unique_by_snapshot' }
);

// Query indexes
SpxOutcomeSchema.index({ horizon: 1, source: 1, hit: 1 });
SpxOutcomeSchema.index({ resolvedDate: 1 });
SpxOutcomeSchema.index({ asOfDate: 1, horizon: 1 });

export const SpxOutcomeModel = 
  models.SpxOutcome || model<SpxOutcomeDoc>('SpxOutcome', SpxOutcomeSchema);

export default SpxOutcomeModel;
