/**
 * FORWARD OUTCOME MODEL
 * 
 * Stores resolved outcomes - what actually happened after horizonDays.
 * Created by the Outcome Resolver when candle data becomes available.
 */
import mongoose from "mongoose";

const ForwardOutcomeSchema = new mongoose.Schema(
  {
    asset: { type: String, required: true, index: true },
    signalId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true, ref: "ForwardSignal" },
    asOfDate: { type: String, required: true, index: true },
    horizonDays: { type: Number, required: true, index: true },

    resolvedAt: { type: String, default: null }, // YYYY-MM-DD
    realizedReturn: { type: Number, default: null }, // decimal
    realizedDirection: { type: String, default: null }, // UP/DOWN/FLAT
    hit: { type: Boolean, default: null }, // true if prediction was correct

    // Optional extras
    maxDrawdown: { type: Number, default: null },
    bandHit: { type: String, default: null }, // IN_P10_P90 | BELOW_P10 | ABOVE_P90

    sources: {
      candles: { type: String, default: null }, // spx_candles
    },
  },
  { timestamps: true }
);

// One outcome per signal
ForwardOutcomeSchema.index(
  { asset: 1, signalId: 1 },
  { unique: true, name: "uniq_asset_signal" }
);

export const ForwardOutcomeModel = mongoose.model("ForwardOutcome", ForwardOutcomeSchema);
