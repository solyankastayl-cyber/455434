/**
 * FORECAST MONGO MODEL (from Verdict)
 * 
 * Block 1: Added healthState and healthSnapshot fields
 * to track model health at forecast creation time.
 */

import mongoose, { Schema } from "mongoose";

const VerdictForecastSchema = new Schema(
  {
    forecastId: { type: String, index: true, unique: true },
    verdictId: { type: String, index: true },

    symbol: { type: String, index: true },
    horizon: { type: String, index: true },

    entryTs: { type: String, index: true },
    resolveAtTs: { type: String, index: true },

    entryPrice: { type: Number },
    expectedReturn: { type: Number },
    action: { type: String },

    // Block 1: Health state at forecast creation time
    // Used for health-weighted credibility calculation
    healthState: { type: String, enum: ["HEALTHY", "DEGRADED", "CRITICAL"], default: "HEALTHY" },
    healthSnapshot: {
      modifier: { type: Number },      // 1.0 / 0.6 / 0.3
      ece: { type: Number },           // Expected Calibration Error
      divergence: { type: Number },    // Model divergence metric
      criticalStreak: { type: Number }, // Consecutive critical readings
      capturedAt: { type: String },    // Timestamp of health capture
    },

    // Evolution fills these
    exitPrice: { type: Number },
    realizedReturn: { type: Number },
    success: { type: Boolean },
    maxDrawdown: { type: Number },

    status: { type: String, default: "OPEN", index: true }, // OPEN|CLOSED
  },
  { timestamps: true, collection: "verdict_forecasts" }
);

export const VerdictForecastModel = 
  mongoose.models.VerdictForecast || mongoose.model("VerdictForecast", VerdictForecastSchema);

console.log('[Verdict] Forecast model loaded');
