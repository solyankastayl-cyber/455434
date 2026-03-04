/**
 * BLOCK 80.3 — Consensus History Model
 * 
 * Stores daily consensus snapshots for timeline visualization.
 * LIVE-only, one record per day per symbol.
 */

import mongoose from 'mongoose';

const ConsensusHistorySchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD (UTC)
    symbol: { type: String, required: true },
    
    // Core metrics
    consensusIndex: { type: Number, default: 0 },
    driftSeverity: { type: String, enum: ['OK', 'WATCH', 'WARN', 'CRITICAL'], default: 'OK' },
    structuralLock: { type: Boolean, default: false },
    
    // Dominance
    dominanceTier: { type: String }, // STRUCTURE, TACTICAL, TIMING
    
    // Volatility
    volRegime: { type: String }, // LOW, NORMAL, HIGH, EXPANSION, CRISIS
    
    // Phase
    phaseType: { type: String },
    phaseGrade: { type: String },
    phaseStrength: { type: Number },
    
    // Divergence
    divergenceScore: { type: Number },
    divergenceGrade: { type: String },
    
    // Decision
    finalAction: { type: String },
    finalSize: { type: Number },
    
    // Metadata
    engineVersion: { type: String, default: 'v2.1.0' },
    policyHash: { type: String },
    source: { type: String, default: 'LIVE' },
    
    // Samples count
    liveSamples: { type: Number, default: 0 },
  },
  { 
    timestamps: true,
    collection: 'consensus_history'
  }
);

// Unique index: one record per symbol per date per source
ConsensusHistorySchema.index(
  { symbol: 1, date: 1, source: 1 },
  { unique: true }
);

ConsensusHistorySchema.index({ date: -1 });
ConsensusHistorySchema.index({ symbol: 1, date: -1 });

export const ConsensusHistoryModel = mongoose.model('ConsensusHistory', ConsensusHistorySchema);

export default ConsensusHistoryModel;
