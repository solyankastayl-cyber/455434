/**
 * FORWARD SIGNAL MODEL
 * 
 * Stores signal snapshots at prediction time.
 * Immutable after creation - represents what the model predicted at asOfDate.
 */
import mongoose from "mongoose";

const ForwardSignalSchema = new mongoose.Schema(
  {
    asset: { type: String, required: true, index: true }, // BTC | SPX
    asOfDate: { type: String, required: true, index: true }, // YYYY-MM-DD
    horizonDays: { type: Number, required: true, index: true }, // 7/14/30/90/180/365

    // Signal Layer (immutable)
    signalAction: { type: String, required: true }, // BUY | HOLD | REDUCE
    forecastReturn: { type: Number, required: true }, // decimal: 0.024
    probUp: { type: Number, required: true }, // 0..1
    entropy: { type: Number, required: true }, // 0..1
    similarity: { type: Number, required: true }, // 0..1
    hybridWeight: { type: Number, default: 0 }, // 0..1

    // Context
    phaseTag: { type: String, default: "UNKNOWN" },
    volRegime: { type: String, default: "UNKNOWN" },
    constitutionHash: { type: String, default: null },
    modelVersion: { type: String, default: null },

    // Debug/audit
    sources: {
      focusPack: { type: String, default: null },
      strategy: { type: String, default: null },
    },

    // Lifecycle linkage
    lifecycleState: { type: String, default: null }, // SIMULATION/WARMUP/APPLIED
    runId: { type: String, default: null },
  },
  { timestamps: true }
);

// Idempotency: one signal per (asset, asOfDate, horizonDays, constitutionHash)
ForwardSignalSchema.index(
  { asset: 1, asOfDate: 1, horizonDays: 1, constitutionHash: 1 },
  { unique: true, name: "uniq_asset_asof_horizon_constitution" }
);

export const ForwardSignalModel = mongoose.model("ForwardSignal", ForwardSignalSchema);
