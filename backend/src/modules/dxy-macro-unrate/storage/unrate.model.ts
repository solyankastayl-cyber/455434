/**
 * UNRATE STORAGE MODEL — MongoDB
 * 
 * Collections:
 * - dxy_macro_unrate_points: Raw unemployment rate data from FRED
 * - dxy_macro_unrate_cache: Computed context cache
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// UNRATE POINTS SCHEMA (raw data)
// ═══════════════════════════════════════════════════════════════

export interface IUnratePoint extends Document {
  seriesId: string;
  date: Date;
  value: number;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const UnratePointSchema = new Schema<IUnratePoint>({
  seriesId: { type: String, required: true, index: true },
  date: { type: Date, required: true },
  value: { type: Number, required: true },
  source: { type: String, default: 'FRED' },
}, {
  timestamps: true,
  collection: 'dxy_macro_unrate_points'
});

// Unique compound index: (seriesId, date)
UnratePointSchema.index({ seriesId: 1, date: 1 }, { unique: true });
UnratePointSchema.index({ date: -1 });

export const UnratePointModel = mongoose.model<IUnratePoint>('UnratePoint', UnratePointSchema);

// ═══════════════════════════════════════════════════════════════
// UNRATE CACHE SCHEMA (computed context)
// ═══════════════════════════════════════════════════════════════

export interface IUnrateCache extends Document {
  asOfDate: Date;
  current: number;
  delta3m: number;
  delta12m: number;
  trend: string;
  regime: string;
  pressure: number;
  createdAt: Date;
  updatedAt: Date;
}

const UnrateCacheSchema = new Schema<IUnrateCache>({
  asOfDate: { type: Date, required: true, unique: true },
  current: { type: Number },
  delta3m: { type: Number },
  delta12m: { type: Number },
  trend: { type: String },
  regime: { type: String },
  pressure: { type: Number },
}, {
  timestamps: true,
  collection: 'dxy_macro_unrate_cache'
});

UnrateCacheSchema.index({ asOfDate: -1 });

export const UnrateCacheModel = mongoose.model<IUnrateCache>('UnrateCache', UnrateCacheSchema);

// ═══════════════════════════════════════════════════════════════
// UNRATE META SCHEMA
// ═══════════════════════════════════════════════════════════════

export interface IUnrateMeta extends Document {
  seriesId: string;
  startDate: Date;
  endDate: Date;
  count: number;
  lastIngestAt: Date;
}

const UnrateMetaSchema = new Schema<IUnrateMeta>({
  seriesId: { type: String, required: true, unique: true },
  startDate: { type: Date },
  endDate: { type: Date },
  count: { type: Number, default: 0 },
  lastIngestAt: { type: Date },
}, {
  timestamps: true,
  collection: 'dxy_macro_unrate_meta'
});

export const UnrateMetaModel = mongoose.model<IUnrateMeta>('UnrateMeta', UnrateMetaSchema);
