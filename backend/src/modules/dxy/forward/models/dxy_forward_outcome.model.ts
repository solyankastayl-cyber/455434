/**
 * DXY FORWARD OUTCOME MODEL
 * 
 * ISOLATION: DXY forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_forward_outcomes
 * Unique index: (asset, asOf, horizonDays)
 */

import mongoose, { Schema } from "mongoose";
import type { DxyForwardOutcome } from "../dxy-forward.types.js";

const DxyForwardOutcomeSchema = new Schema<DxyForwardOutcome>(
  {
    asset: { type: String, required: true, enum: ["DXY"], index: true },
    asOf: { type: String, required: true, index: true },
    horizonDays: { type: Number, required: true, index: true },
    targetDate: { type: String, required: true, index: true },

    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number, required: true },
    realizedReturn: { type: Number, required: true },

    isResolved: { type: Boolean, required: true, index: true },
    resolvedAt: { type: Date, required: false },
    wasFutureAtResolve: { type: Boolean, required: false },
  },
  { timestamps: true, collection: 'dxy_forward_outcomes' }
);

DxyForwardOutcomeSchema.index(
  { asset: 1, asOf: 1, horizonDays: 1 },
  { unique: true, name: "uniq_dxy_outcome_asset_asof_horizon" }
);

export const DxyForwardOutcomeModel =
  mongoose.models.DxyForwardOutcome ||
  mongoose.model<DxyForwardOutcome>("DxyForwardOutcome", DxyForwardOutcomeSchema);
