/**
 * DXY FORWARD SIGNAL MODEL
 * 
 * ISOLATION: DXY forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_forward_signals
 * Unique index: (asset, asOf, horizonDays)
 */

import mongoose, { Schema } from "mongoose";
import type { DxyForwardSignal } from "../dxy-forward.types.js";

const DxyForwardSignalSchema = new Schema<DxyForwardSignal>(
  {
    asset: { type: String, required: true, enum: ["DXY"], index: true },
    asOf: { type: String, required: true, index: true },
    horizonDays: { type: Number, required: true, index: true },

    action: { type: String, required: true, enum: ["LONG", "SHORT", "HOLD"] },

    forecastReturn: { type: Number, required: true },
    probUp: { type: Number, required: true, min: 0, max: 1 },
    similarity: { type: Number, required: true, min: 0, max: 1 },
    entropy: { type: Number, required: true, min: 0, max: 1 },

    modelVersion: { type: String, required: true },
    constitutionHash: { type: String, required: false, default: null },

    diagnostics: {
      sources: {
        matches: { type: String, required: false },
        entropy: { type: String, required: false },
        tailRisk: { type: String, required: false },
        drawdown: { type: String, required: false },
        scan: { type: String, required: false },
      },
    },
  },
  { timestamps: true, collection: 'dxy_forward_signals' }
);

// Уникальность: один сигнал на (asset, asOf, horizonDays)
DxyForwardSignalSchema.index(
  { asset: 1, asOf: 1, horizonDays: 1 },
  { unique: true, name: "uniq_dxy_signal_asset_asof_horizon" }
);

export const DxyForwardSignalModel =
  mongoose.models.DxyForwardSignal ||
  mongoose.model<DxyForwardSignal>("DxyForwardSignal", DxyForwardSignalSchema);
