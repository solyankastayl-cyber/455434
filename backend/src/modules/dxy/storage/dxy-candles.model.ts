/**
 * DXY CANDLES MODEL — MongoDB Storage
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// DXY CANDLE SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface IDxyCandle extends Document {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const DxyCandleSchema = new Schema<IDxyCandle>({
  date: { type: Date, required: true, unique: true, index: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, default: 0 },
  source: { type: String, default: 'STOOQ' },
}, { 
  timestamps: true,
  collection: 'dxy_candles'
});

// Indexes for efficient queries
DxyCandleSchema.index({ date: -1 });
DxyCandleSchema.index({ source: 1, date: -1 });

export const DxyCandleModel = mongoose.model<IDxyCandle>('DxyCandle', DxyCandleSchema);

// ═══════════════════════════════════════════════════════════════
// DXY META SCHEMA — Track data integrity
// ═══════════════════════════════════════════════════════════════

export interface IDxyMeta extends Document {
  source: string;
  startDate: Date;
  endDate: Date;
  count: number;
  lastIngestAt: Date;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
}

const DxyMetaSchema = new Schema<IDxyMeta>({
  source: { type: String, required: true },
  startDate: { type: Date },
  endDate: { type: Date },
  count: { type: Number, default: 0 },
  lastIngestAt: { type: Date },
  checksum: { type: String },
}, {
  timestamps: true,
  collection: 'dxy_candles_meta'
});

export const DxyMetaModel = mongoose.model<IDxyMeta>('DxyMeta', DxyMetaSchema);
