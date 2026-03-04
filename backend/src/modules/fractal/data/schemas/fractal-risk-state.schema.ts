/**
 * BLOCK 29.18: Risk State Schema
 * Tracks equity/drawdown state for live risk management
 */

import { Schema, model } from 'mongoose';

const FractalRiskStateSchema = new Schema(
  {
    symbol: { type: String, required: true },

    // Current equity state
    equity: { type: Number, default: 1 },
    peakEquity: { type: Number, default: 1 },

    // Last trade timestamp
    lastTs: { type: Date },

    // Cool down state
    inCoolDown: { type: Boolean, default: false },
    coolDownUntil: { type: Date },

    updatedAt: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

FractalRiskStateSchema.index({ symbol: 1 }, { unique: true });

export const FractalRiskStateModel = model('fractal_risk_state', FractalRiskStateSchema);
