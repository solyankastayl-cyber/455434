/**
 * CPI STORAGE MODEL — MongoDB
 * 
 * Collections:
 * - dxy_macro_cpi_points: Raw CPI data from FRED
 * - dxy_macro_cpi_cache: Computed CPI context cache
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// CPI POINTS SCHEMA (raw data)
// ═══════════════════════════════════════════════════════════════

export interface ICpiPoint extends Document {
  seriesId: string;
  date: Date;
  value: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const CpiPointSchema = new Schema<ICpiPoint>({
  seriesId: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  value: { type: Number, required: true },
  source: { type: String, default: 'FRED' },
}, {
  timestamps: true,
  collection: 'dxy_macro_cpi_points'
});

// Unique compound index: (seriesId, date)
CpiPointSchema.index({ seriesId: 1, date: 1 }, { unique: true });
CpiPointSchema.index({ date: -1 });

export const CpiPointModel = mongoose.model<ICpiPoint>('CpiPoint', CpiPointSchema);

// ═══════════════════════════════════════════════════════════════
// CPI CACHE SCHEMA (computed context)
// ═══════════════════════════════════════════════════════════════

export interface ICpiCache extends Document {
  asOfDate: Date;
  headline: {
    latestValue: number;
    yoy: number;
    mom: number;
    ann3m: number;
    trendYoy3m: number;
  };
  core: {
    latestValue: number;
    yoy: number;
    mom: number;
    ann3m: number;
    trendYoy3m: number;
  };
  regime: string;
  pressure: number;
  createdAt: Date;
  updatedAt: Date;
}

const CpiCacheSchema = new Schema<ICpiCache>({
  asOfDate: { type: Date, required: true, unique: true },
  headline: {
    latestValue: Number,
    yoy: Number,
    mom: Number,
    ann3m: Number,
    trendYoy3m: Number,
  },
  core: {
    latestValue: Number,
    yoy: Number,
    mom: Number,
    ann3m: Number,
    trendYoy3m: Number,
  },
  regime: { type: String },
  pressure: { type: Number },
}, {
  timestamps: true,
  collection: 'dxy_macro_cpi_cache'
});

CpiCacheSchema.index({ asOfDate: -1 });

export const CpiCacheModel = mongoose.model<ICpiCache>('CpiCache', CpiCacheSchema);

// ═══════════════════════════════════════════════════════════════
// CPI META SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface ICpiMeta extends Document {
  seriesId: string;
  startDate: Date;
  endDate: Date;
  count: number;
  lastIngestAt: Date;
}

const CpiMetaSchema = new Schema<ICpiMeta>({
  seriesId: { type: String, required: true, unique: true },
  startDate: { type: Date },
  endDate: { type: Date },
  count: { type: Number, default: 0 },
  lastIngestAt: { type: Date },
}, {
  timestamps: true,
  collection: 'dxy_macro_cpi_meta'
});

export const CpiMetaModel = mongoose.model<ICpiMeta>('CpiMeta', CpiMetaSchema);
