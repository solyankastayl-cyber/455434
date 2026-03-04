/**
 * MACRO SERIES META MODEL — B1
 * 
 * MongoDB schema for macro series metadata.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import mongoose, { Schema, Document } from 'mongoose';
import { MacroFrequency, MacroRole } from '../data/macro_sources.registry.js';

export interface IMacroSeriesMeta extends Document {
  seriesId: string;
  displayName: string;
  frequency: MacroFrequency;
  units: string;
  role: MacroRole;
  source: string;
  pointCount: number;
  firstDate: string;
  lastDate: string;
  coverageYears: number;
  lastIngestAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const MacroSeriesMetaSchema = new Schema<IMacroSeriesMeta>(
  {
    seriesId: { type: String, required: true, unique: true },
    displayName: { type: String, required: true },
    frequency: { type: String, required: true },
    units: { type: String, required: true },
    role: { type: String, required: true },
    source: { type: String, required: true, default: 'FRED' },
    pointCount: { type: Number, default: 0 },
    firstDate: { type: String },
    lastDate: { type: String },
    coverageYears: { type: Number, default: 0 },
    lastIngestAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'macro_series_meta',
  }
);

export const MacroSeriesMetaModel = mongoose.model<IMacroSeriesMeta>('MacroSeriesMeta', MacroSeriesMetaSchema);
