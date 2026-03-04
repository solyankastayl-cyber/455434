/**
 * BLOCK 81 — Drift Intelligence History Model
 * 
 * Stores daily drift intelligence snapshots for timeline views.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface DriftIntelHistoryDocument extends Document {
  date: string;
  symbol: string;
  source: 'LIVE';
  
  severity: string;
  confidence: string;
  insufficientLiveTruth: boolean;
  
  liveSamples: number;
  
  dHitRate_pp: number;
  dSharpe: number;
  dCalibration_pp: number;
  dMaxDD_pp: number;
  
  baseline: string;
  
  reasons: string[];
  
  engineVersion: string;
  policyHash: string;
  
  createdAt: Date;
  updatedAt: Date;
}

const DriftIntelHistorySchema = new Schema<DriftIntelHistoryDocument>(
  {
    date: { type: String, required: true },
    symbol: { type: String, required: true, default: 'BTC' },
    source: { type: String, required: true, default: 'LIVE' },
    
    severity: { type: String, required: true },
    confidence: { type: String, required: true },
    insufficientLiveTruth: { type: Boolean, default: false },
    
    liveSamples: { type: Number, default: 0 },
    
    dHitRate_pp: { type: Number, default: 0 },
    dSharpe: { type: Number, default: 0 },
    dCalibration_pp: { type: Number, default: 0 },
    dMaxDD_pp: { type: Number, default: 0 },
    
    baseline: { type: String, default: 'V2020' },
    
    reasons: [{ type: String }],
    
    engineVersion: { type: String, default: 'v2.1.0' },
    policyHash: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'drift_intel_history',
  }
);

// Unique index: one entry per symbol+date+source
DriftIntelHistorySchema.index({ symbol: 1, date: 1, source: 1 }, { unique: true });

// Index for timeline queries
DriftIntelHistorySchema.index({ symbol: 1, source: 1, date: -1 });

export const DriftIntelHistoryModel = mongoose.model<DriftIntelHistoryDocument>(
  'DriftIntelHistory',
  DriftIntelHistorySchema
);

export default DriftIntelHistoryModel;
