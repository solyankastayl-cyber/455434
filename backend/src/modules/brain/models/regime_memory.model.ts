/**
 * P10.1 — Regime Memory State Model
 * 
 * MongoDB model for regime_memory_state collection.
 * Stores historical regime states for each scope.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IRegimeTransition {
  value: string;
  since: Date;
  until: Date;
  days: number;
}

export interface IRegimeMemoryDoc extends Document {
  scope: 'macro' | 'guard' | 'crossAsset';
  current: string;
  since: Date;
  daysInState: number;
  flips30d: number;
  stability: number;
  lastUpdated: Date;
  previousStates: IRegimeTransition[];
  // For determinism: track input hash
  lastInputHash: string;
}

const RegimeTransitionSchema = new Schema({
  value: { type: String, required: true },
  since: { type: Date, required: true },
  until: { type: Date, required: true },
  days: { type: Number, required: true },
}, { _id: false });

const RegimeMemorySchema = new Schema<IRegimeMemoryDoc>({
  scope: { 
    type: String, 
    enum: ['macro', 'guard', 'crossAsset'], 
    required: true,
    unique: true,
  },
  current: { type: String, required: true },
  since: { type: Date, required: true },
  daysInState: { type: Number, default: 0 },
  flips30d: { type: Number, default: 0 },
  stability: { type: Number, default: 0.5 },
  lastUpdated: { type: Date, default: Date.now },
  previousStates: { type: [RegimeTransitionSchema], default: [] },
  lastInputHash: { type: String, default: '' },
}, {
  timestamps: true,
});

// Index for quick lookups
RegimeMemorySchema.index({ scope: 1 });

export const RegimeMemoryModel = mongoose.model<IRegimeMemoryDoc>(
  'RegimeMemoryState', 
  RegimeMemorySchema, 
  'regime_memory_state'
);

// ═══════════════════════════════════════════════════════════════
// REGIME HISTORY MODEL — For timeline queries and flip counting
// ═══════════════════════════════════════════════════════════════

export interface IRegimeHistoryDoc extends Document {
  scope: 'macro' | 'guard' | 'crossAsset';
  date: Date;
  value: string;
  inputHash: string;
}

const RegimeHistorySchema = new Schema<IRegimeHistoryDoc>({
  scope: { 
    type: String, 
    enum: ['macro', 'guard', 'crossAsset'], 
    required: true 
  },
  date: { type: Date, required: true },
  value: { type: String, required: true },
  inputHash: { type: String, default: '' },
}, {
  timestamps: false,
});

// Unique per scope+date for determinism
RegimeHistorySchema.index({ scope: 1, date: 1 }, { unique: true });
RegimeHistorySchema.index({ date: -1 });

export const RegimeHistoryModel = mongoose.model<IRegimeHistoryDoc>(
  'RegimeHistory',
  RegimeHistorySchema,
  'regime_history'
);
