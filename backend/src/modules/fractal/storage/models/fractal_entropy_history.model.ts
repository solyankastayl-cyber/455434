/**
 * BLOCK 43.1 — Fractal Entropy History Model
 * Monitors Entropy Guard over time
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IFractalEntropyHistory extends Document {
  ts: number;           // unix ms
  modelKey: string;
  presetKey: string;
  entropy: number;      // 0..1
  emaEntropy: number;
  sizeMultiplier: number;  // 0.25..1
  dominance?: number;
  horizons?: Record<string, any>;  // per-horizon signals/probs
}

const FractalEntropyHistorySchema = new Schema<IFractalEntropyHistory>(
  {
    ts: { type: Number, required: true, index: true },
    modelKey: { type: String, required: true, index: true },
    presetKey: { type: String, required: true, index: true },
    entropy: { type: Number, required: true },
    emaEntropy: { type: Number, required: true },
    sizeMultiplier: { type: Number, required: true },
    dominance: Number,
    horizons: Schema.Types.Mixed,
  },
  { 
    versionKey: false,
    collection: 'fractal_entropy_history'
  }
);

FractalEntropyHistorySchema.index({ modelKey: 1, presetKey: 1, ts: -1 });

export const FractalEntropyHistoryModel = mongoose.model<IFractalEntropyHistory>(
  'FractalEntropyHistory',
  FractalEntropyHistorySchema
);
