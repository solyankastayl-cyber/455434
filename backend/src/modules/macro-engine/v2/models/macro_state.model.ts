/**
 * MACRO REGIME STATE MODEL — MongoDB Storage
 * 
 * Stores regime state history for Markov memory + hysteresis.
 * V2 doesn't just compute regime on a point — it maintains state machine.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// REGIME STATE DOCUMENT
// ═══════════════════════════════════════════════════════════════

export interface IMacroRegimeState extends Document {
  symbol: string;                 // DXY | SPX | BTC
  asOf: Date;
  
  // Current regime
  dominant: string;               // EASING | TIGHTENING | STRESS | NEUTRAL | NEUTRAL_MIXED
  probs: Map<string, number>;     // P(regime) for all regimes
  
  // Markov metrics
  persistence: number;            // Stay probability (0..1)
  entropy: number;                // Regime uncertainty (0..1)
  
  // Hysteresis
  lastChangeAt: Date;             // When regime last changed
  changeCount30D: number;         // Changes in last 30 days
  
  // Diagnostics
  scoreSigned: number;
  confidence: number;
  transitionHint?: string;
  
  // Metadata
  sourceVersion: string;          // v1 | v2
  createdAt: Date;
}

const MacroRegimeStateSchema = new Schema<IMacroRegimeState>({
  symbol: { type: String, required: true, index: true },
  asOf: { type: Date, required: true, index: true },
  
  dominant: { type: String, required: true },
  probs: { type: Map, of: Number },
  
  persistence: { type: Number, default: 0.5 },
  entropy: { type: Number, default: 0.5 },
  
  lastChangeAt: { type: Date },
  changeCount30D: { type: Number, default: 0 },
  
  scoreSigned: { type: Number, default: 0 },
  confidence: { type: Number, default: 0.5 },
  transitionHint: { type: String },
  
  sourceVersion: { type: String, default: 'v2' },
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'macro_regime_states',
  timestamps: false,
});

// Compound index for efficient queries
MacroRegimeStateSchema.index({ symbol: 1, asOf: -1 });

export const MacroRegimeStateModel = mongoose.model<IMacroRegimeState>(
  'MacroRegimeState',
  MacroRegimeStateSchema
);

// ═══════════════════════════════════════════════════════════════
// WEIGHTS VERSION MODEL
// ═══════════════════════════════════════════════════════════════

export interface IMacroWeightsVersion extends Document {
  symbol: string;
  asOf: Date;
  windowDays: number;             // Rolling window size (e.g., 1260 = 5 years)
  stepDays: number;               // Recalibration frequency
  
  // P5.6 + P5.9 fields
  versionId?: string;             // Unique version identifier
  objective?: string;             // HIT_RATE | MAE | RMSE
  perHorizon?: boolean;           // Per-horizon calibration flag
  
  // Per-horizon weights (P5.9)
  weightsPerHorizon?: Array<{
    horizon: string;              // 30D | 90D | 180D | 365D
    weights: Array<{
      seriesId: string;
      weight: number;
      lagDays: number;
    }>;
  }>;
  
  // Per-horizon metrics
  metrics?: Record<string, {
    v2: { hitRate: number; mae?: number; rmse?: number };
    v1: { hitRate: number; mae?: number; rmse?: number };
    delta: { hitRate: number; mae?: number; rmse?: number };
  }>;
  
  components: Array<{
    key: string;                  // T10Y2Y, GOLD, FEDFUNDS, etc.
    role: string;                 // rates, gold, inflation, etc.
    corr: number;                 // Correlation with DXY forward
    lagDays: number;              // Optimal lag
    weight: number;               // Normalized weight
  }>;
  
  aggregateCorr: number;          // Weighted aggregate correlation
  qualityScore: number;           // Data quality (0..100)
  
  createdAt: Date;
}

const MacroWeightsVersionSchema = new Schema<IMacroWeightsVersion>({
  symbol: { type: String, required: true, index: true },
  asOf: { type: Date, required: true, index: true },
  windowDays: { type: Number, required: true },
  stepDays: { type: Number, default: 30 },
  
  // P5.6 + P5.9 fields
  versionId: { type: String, index: true },
  objective: { type: String },
  perHorizon: { type: Boolean, default: false },
  
  weightsPerHorizon: [{
    horizon: { type: String },
    weights: [{
      seriesId: { type: String },
      weight: { type: Number },
      lagDays: { type: Number },
    }],
  }],
  
  metrics: { type: Schema.Types.Mixed },
  
  components: [{
    key: { type: String, required: true },
    role: { type: String },
    corr: { type: Number },
    lagDays: { type: Number },
    weight: { type: Number },
  }],
  
  aggregateCorr: { type: Number },
  qualityScore: { type: Number },
  
  createdAt: { type: Date, default: Date.now },
}, {
  collection: 'macro_weights_versions',
  timestamps: false,
});

MacroWeightsVersionSchema.index({ symbol: 1, asOf: -1 });

export const MacroWeightsVersionModel = mongoose.model<IMacroWeightsVersion>(
  'MacroWeightsVersion',
  MacroWeightsVersionSchema
);
