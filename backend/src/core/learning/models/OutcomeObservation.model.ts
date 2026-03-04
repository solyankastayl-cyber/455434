/**
 * Outcome Observation Model
 * 
 * Records what actually happened after a prediction.
 * Multi-horizon: 1d, 7d, 30d
 * 
 * NO interpretations - pure facts only.
 */
import mongoose from 'mongoose';
import type { OutcomePoint, OutcomeHorizons, Horizon } from '../learning.types.js';

export interface IOutcomeObservation {
  // Link to snapshot
  snapshotId: string;
  tokenAddress: string;
  
  // Multi-horizon outcomes
  horizons: OutcomeHorizons;
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const OutcomePointSchema = new mongoose.Schema({
  price: { type: Number, required: true },
  returnPct: { type: Number, required: true },
  volume: { type: Number, required: true },
  volumeChangePct: { type: Number, required: true },
  maxDrawdownPct: { type: Number, required: true },
  resolvedAt: { type: Date, required: true },
}, { _id: false });

const OutcomeObservationSchema = new mongoose.Schema<IOutcomeObservation>({
  snapshotId: {
    type: String,
    required: true,
  },
  tokenAddress: {
    type: String,
    required: true,
    lowercase: true,
  },
  horizons: {
    '1d': { type: OutcomePointSchema, required: false },
    '7d': { type: OutcomePointSchema, required: false },
    '30d': { type: OutcomePointSchema, required: false },
  },
}, {
  collection: 'outcome_observations',
  timestamps: true,
});

// Indexes
OutcomeObservationSchema.index({ snapshotId: 1 }, { unique: true });
OutcomeObservationSchema.index({ tokenAddress: 1 });
OutcomeObservationSchema.index({ createdAt: -1 });

export const OutcomeObservationModel = mongoose.model<IOutcomeObservation>(
  'OutcomeObservation',
  OutcomeObservationSchema
);
