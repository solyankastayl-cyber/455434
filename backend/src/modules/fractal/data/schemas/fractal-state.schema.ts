import { Schema, model, Model } from 'mongoose';
import { FractalState } from '../../contracts/fractal.contracts.js';

const FractalStateSchema = new Schema<FractalState>(
  {
    _id: { type: String },
    symbol: { type: String, required: true },
    timeframe: { type: String, required: true },
    bootstrap: {
      done: { type: Boolean, default: false },
      startedAt: { type: Date },
      finishedAt: { type: Date }
    },
    lastCanonicalTs: { type: Date },
    lastUpdateAt: { type: Date },
    gaps: {
      count: { type: Number, default: 0 },
      lastScanAt: { type: Date }
    },
    sources: {
      primary: { type: String },
      fallback: { type: [String], default: [] }
    }
  },
  { 
    versionKey: false,
    collection: 'fractal_state'
  }
);

export const FractalStateModel: Model<FractalState> = model<FractalState>(
  'fractal_state',
  FractalStateSchema
);
