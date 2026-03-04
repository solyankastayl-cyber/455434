import { Schema, model, Model } from 'mongoose';
import { RawOhlcvDocument } from '../../contracts/fractal.contracts.js';

const RawOhlcvSchema = new Schema<RawOhlcvDocument>(
  {
    meta: {
      symbol: { type: String, required: true },
      timeframe: { type: String, required: true },
      source: { type: String, required: true }
    },
    ts: { type: Date, required: true },
    ohlcv: {
      o: { type: Number, required: true },
      h: { type: Number, required: true },
      l: { type: Number, required: true },
      c: { type: Number, required: true },
      v: { type: Number, required: true }
    },
    quality: {
      sanity_ok: { type: Boolean, default: true },
      flags: { type: [String], default: [] }
    },
    ingestedAt: { type: Date, default: Date.now }
  },
  { 
    versionKey: false,
    collection: 'fractal_raw_ohlcv'
  }
);

// Unique index by source
RawOhlcvSchema.index(
  { 'meta.symbol': 1, 'meta.timeframe': 1, 'meta.source': 1, ts: 1 },
  { unique: true }
);

// Query index
RawOhlcvSchema.index(
  { 'meta.symbol': 1, 'meta.timeframe': 1, ts: 1 }
);

export const RawOhlcvModel: Model<RawOhlcvDocument> = model<RawOhlcvDocument>(
  'fractal_raw_ohlcv',
  RawOhlcvSchema
);
