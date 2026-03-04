/**
 * SPX DRIFT — History Model
 * 
 * BLOCK B6.3 — MongoDB model for drift history
 */

import mongoose, { Schema } from 'mongoose';
import type { DriftWindow, SpxCohort, DriftSeverity, DriftConfidence } from './spx-drift.types.js';

const SpxDriftHistorySchema = new Schema(
  {
    symbol: { type: String, enum: ['SPX'], required: true, index: true },
    date: { type: String, required: true },
    window: { 
      type: String, 
      enum: ['30d', '60d', '90d', '180d', '365d'], 
      required: true 
    },
    compare: { 
      type: String, 
      enum: ['LIVE', 'V2020', 'V1950', 'ALL_VINTAGE'], 
      required: true 
    },

    live: {
      samples: { type: Number, required: true },
      hitRate: { type: Number, required: true },
      expectancy: { type: Number, required: true },
      sharpe: { type: Number, required: true },
      maxDD: { type: Number, required: true },
    },

    vintage: {
      samples: { type: Number, required: true },
      hitRate: { type: Number, required: true },
      expectancy: { type: Number, required: true },
      sharpe: { type: Number, required: true },
      maxDD: { type: Number, required: true },
    },

    delta: {
      hitRate: { type: Number, required: true },
      expectancy: { type: Number, required: true },
      sharpe: { type: Number, required: true },
      maxDD: { type: Number, required: true },
    },

    severity: { 
      type: String, 
      enum: ['OK', 'WATCH', 'WARN', 'CRITICAL'], 
      required: true 
    },
    confidence: { 
      type: String, 
      enum: ['LOW', 'MEDIUM', 'HIGH'], 
      required: true 
    },
    notes: { type: [String], default: [] },
  },
  { 
    timestamps: true,
    collection: 'spx_drift_history',
  }
);

// Unique idempotent index
SpxDriftHistorySchema.index(
  { symbol: 1, date: 1, window: 1, compare: 1 }, 
  { unique: true }
);

export const SpxDriftHistoryModel = 
  mongoose.models.SpxDriftHistory || 
  mongoose.model('SpxDriftHistory', SpxDriftHistorySchema);

export default SpxDriftHistoryModel;
