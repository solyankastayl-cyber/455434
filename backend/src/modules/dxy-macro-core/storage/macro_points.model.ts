/**
 * MACRO POINTS MODEL — B1
 * 
 * MongoDB schema for macro data points.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IMacroPoint extends Document {
  seriesId: string;
  date: string;         // ISO date (YYYY-MM-DD)
  value: number;
  source: string;       // "FRED" | "MANUAL" | etc.
  createdAt: Date;
  updatedAt: Date;
}

const MacroPointSchema = new Schema<IMacroPoint>(
  {
    seriesId: { type: String, required: true, index: true },
    date: { type: String, required: true },
    value: { type: Number, required: true },
    source: { type: String, required: true, default: 'FRED' },
  },
  {
    timestamps: true,
    collection: 'macro_points',
  }
);

// Compound unique index: one point per series per date
MacroPointSchema.index({ seriesId: 1, date: 1 }, { unique: true });

// Index for date queries
MacroPointSchema.index({ date: -1 });

export const MacroPointModel = mongoose.model<IMacroPoint>('MacroPoint', MacroPointSchema);
