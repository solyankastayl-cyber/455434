/**
 * PHASE 1.4 — Price History Model
 * =================================
 * 
 * MongoDB model for storing historical price bars.
 */

import mongoose from 'mongoose';

const PriceBarSchema = new mongoose.Schema({
  symbol: { type: String, required: true, index: true },
  tf: { type: String, required: true, index: true },
  ts: { type: Number, required: true, index: true },
  o: { type: Number, required: true },
  h: { type: Number, required: true },
  l: { type: Number, required: true },
  c: { type: Number, required: true },
  v: { type: Number },
  source: { type: String, required: true },
}, {
  timestamps: true,
  collection: 'market_price_history',
});

// Compound unique index
PriceBarSchema.index({ symbol: 1, tf: 1, ts: 1 }, { unique: true });

export const PriceBarModel = mongoose.model('PriceBar', PriceBarSchema);

console.log('[Phase 1.4] PriceBar Model loaded');
