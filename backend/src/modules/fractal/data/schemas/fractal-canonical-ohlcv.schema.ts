import { Schema, model, Model } from 'mongoose';
import { CanonicalOhlcvDocument } from '../../contracts/fractal.contracts.js';

const CanonicalOhlcvSchema = new Schema<CanonicalOhlcvDocument>(
  {
    meta: {
      symbol: { type: String, required: true },
      timeframe: { type: String, required: true }
    },
    ts: { type: Date, required: true },
    ohlcv: {
      o: { type: Number, required: true },
      h: { type: Number, required: true },
      l: { type: Number, required: true },
      c: { type: Number, required: true },
      v: { type: Number, required: true }
    },
    provenance: {
      chosenSource: { type: String, required: true },
      candidates: { type: [Object], default: [] }
    },
    quality: {
      qualityScore: { type: Number, default: 1 },
      flags: { type: [String], default: [] },
      sanity_ok: { type: Boolean, default: true }
    },
    updatedAt: { type: Date, default: Date.now }
  },
  { 
    versionKey: false,
    collection: 'fractal_canonical_ohlcv'
  }
);

// Unique index
CanonicalOhlcvSchema.index(
  { 'meta.symbol': 1, 'meta.timeframe': 1, ts: 1 },
  { unique: true }
);

// Query index for range queries
CanonicalOhlcvSchema.index(
  { 'meta.symbol': 1, 'meta.timeframe': 1 }
);

export const CanonicalOhlcvModel: Model<CanonicalOhlcvDocument> = model<CanonicalOhlcvDocument>(
  'fractal_canonical_ohlcv',
  CanonicalOhlcvSchema
);
