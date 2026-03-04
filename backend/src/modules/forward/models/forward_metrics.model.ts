/**
 * FORWARD METRICS MODEL
 * 
 * Aggregated performance metrics by asset and horizon.
 * Updated incrementally by the Metrics Aggregator.
 */
import mongoose from "mongoose";

const ForwardMetricsSchema = new mongoose.Schema(
  {
    asset: { type: String, required: true, index: true },
    horizonDays: { type: Number, required: true, index: true },

    sampleSize: { type: Number, required: true, default: 0 },
    hitRate: { type: Number, default: null }, // 0..1
    avgRealizedReturn: { type: Number, default: null },
    avgForecastReturn: { type: Number, default: null },
    bias: { type: Number, default: null }, // realized - forecast

    updatedAsOf: { type: String, default: null },
  },
  { timestamps: true }
);

ForwardMetricsSchema.index(
  { asset: 1, horizonDays: 1 },
  { unique: true, name: "uniq_asset_horizon" }
);

export const ForwardMetricsModel = mongoose.model("ForwardMetrics", ForwardMetricsSchema);
