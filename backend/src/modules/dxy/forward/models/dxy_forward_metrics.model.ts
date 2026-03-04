/**
 * DXY FORWARD METRICS MODEL (cache)
 * 
 * ISOLATION: DXY forward models. No BTC/SPX imports.
 * 
 * Collection: dxy_forward_metrics
 * Unique index: (asset, window, horizonDays)
 */

import mongoose, { Schema } from "mongoose";
import type { DxyForwardMetrics } from "../dxy-forward.types.js";

const DxyForwardMetricsSchema = new Schema<DxyForwardMetrics>(
  {
    asset: { type: String, required: true, enum: ["DXY"], index: true },
    window: { type: String, required: true, enum: ["ALL", "1Y", "5Y", "10Y"], index: true },
    horizonDays: { type: Number, required: true, index: true },

    sampleCount: { type: Number, required: true },
    hitRate: { type: Number, required: true },
    avgReturn: { type: Number, required: true },
    bias: { type: Number, required: true },
    maxDrawdown: { type: Number, required: true },
  },
  { timestamps: true, collection: 'dxy_forward_metrics' }
);

DxyForwardMetricsSchema.index(
  { asset: 1, window: 1, horizonDays: 1 },
  { unique: true, name: "uniq_dxy_metrics_asset_window_horizon" }
);

export const DxyForwardMetricsModel =
  mongoose.models.DxyForwardMetrics ||
  mongoose.model<DxyForwardMetrics>("DxyForwardMetrics", DxyForwardMetricsSchema);
