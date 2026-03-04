/**
 * BLOCK 82 — Intel Timeline Model
 * 
 * Stores daily phase strength + dominance history snapshots.
 * Key: (date, symbol, source) UNIQUE
 * 
 * Sources:
 * - LIVE: Daily scheduler writes
 * - V2014: Historical backfill (vintage)
 * - V2020: Historical backfill (modern)
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type IntelTimelineSource = 'LIVE' | 'V2014' | 'V2020';
export type DominanceTier = 'STRUCTURE' | 'TACTICAL' | 'TIMING';
export type PhaseGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type PhaseType = 'MARKUP' | 'MARKDOWN' | 'DISTRIBUTION' | 'ACCUMULATION' | 'NEUTRAL';
export type VolRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'CRISIS';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TierWeights {
  structure: number;
  tactical: number;
  timing: number;
}

export interface IntelTimelineSnapshot {
  date: string;            // YYYY-MM-DD
  symbol: string;          // BTC
  source: IntelTimelineSource;
  
  // Phase metrics
  phaseType: PhaseType;
  phaseGrade: PhaseGrade;
  phaseScore: number;      // 0-100
  phaseSharpe: number;
  phaseHitRate: number;
  phaseExpectancy: number;
  phaseSamples: number;
  
  // Dominance metrics
  dominanceTier: DominanceTier;
  structuralLock: boolean;
  timingOverrideBlocked: boolean;
  tierWeights: TierWeights;
  
  // Context
  volRegime: VolRegime;
  divergenceGrade: DivergenceGrade;
  divergenceScore: number;
  
  // Decision snapshot
  finalAction: string;
  finalSize: number;
  consensusIndex: number;
  conflictLevel: string;
  
  // Meta
  engineVersion: string;
  policyHash: string;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const IntelTimelineSchema = new Schema<IntelTimelineSnapshot>({
  date: { type: String, required: true, index: true },
  symbol: { type: String, required: true, default: 'BTC', index: true },
  source: { type: String, required: true, enum: ['LIVE', 'V2014', 'V2020'], index: true },
  
  // Phase
  phaseType: { type: String, enum: ['MARKUP', 'MARKDOWN', 'DISTRIBUTION', 'ACCUMULATION', 'NEUTRAL'], default: 'NEUTRAL' },
  phaseGrade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], default: 'C' },
  phaseScore: { type: Number, default: 50 },
  phaseSharpe: { type: Number, default: 0 },
  phaseHitRate: { type: Number, default: 0.5 },
  phaseExpectancy: { type: Number, default: 0 },
  phaseSamples: { type: Number, default: 0 },
  
  // Dominance
  dominanceTier: { type: String, enum: ['STRUCTURE', 'TACTICAL', 'TIMING'], default: 'STRUCTURE' },
  structuralLock: { type: Boolean, default: false },
  timingOverrideBlocked: { type: Boolean, default: false },
  tierWeights: {
    structure: { type: Number, default: 0.5 },
    tactical: { type: Number, default: 0.3 },
    timing: { type: Number, default: 0.2 },
  },
  
  // Context
  volRegime: { type: String, enum: ['LOW', 'NORMAL', 'HIGH', 'EXTREME', 'CRISIS'], default: 'NORMAL' },
  divergenceGrade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], default: 'C' },
  divergenceScore: { type: Number, default: 50 },
  
  // Decision
  finalAction: { type: String, default: 'HOLD' },
  finalSize: { type: Number, default: 0 },
  consensusIndex: { type: Number, default: 50 },
  conflictLevel: { type: String, default: 'LOW' },
  
  // Meta
  engineVersion: { type: String, default: 'v2.1.0' },
  policyHash: { type: String, default: '' },
}, {
  timestamps: true,
  collection: 'intel_timeline_daily',
});

// Unique compound index (date + symbol + source)
IntelTimelineSchema.index({ date: 1, symbol: 1, source: 1 }, { unique: true });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export interface IntelTimelineDocument extends IntelTimelineSnapshot, Document {}

export const IntelTimelineModel = mongoose.model<IntelTimelineDocument>(
  'IntelTimelineDaily',
  IntelTimelineSchema
);

export default IntelTimelineModel;
