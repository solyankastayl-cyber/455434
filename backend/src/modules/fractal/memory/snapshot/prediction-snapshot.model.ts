/**
 * BLOCK 75.1 — Prediction Snapshot Model
 * 
 * Immutable record of system state at prediction time.
 * Stores full terminal payload for later truth validation.
 * 
 * Schema: (symbol, asofDate, focus, role, preset, source) → unique
 * 
 * BLOCK 77.4: Added source/policyHash/engineVersion for LIVE vs BOOTSTRAP isolation
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type FocusHorizon = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';
export type SnapshotRole = 'ACTIVE' | 'SHADOW';
export type SnapshotPreset = 'conservative' | 'balanced' | 'aggressive';
export type TierType = 'TIMING' | 'TACTICAL' | 'STRUCTURE';
export type DirectionType = 'BUY' | 'SELL' | 'HOLD';
export type ModeType = 'TREND_FOLLOW' | 'COUNTER_TREND' | 'NO_TRADE' | 'WAIT';
export type GradeType = 'A' | 'B' | 'C' | 'D' | 'F';

// BLOCK 77.4: Data source type
export type DataSourceType = 'LIVE' | 'BOOTSTRAP';

// BLOCK 77.6: Cohort type for vintage isolation
export type CohortType = 'LIVE' | 'V2020' | 'V2014';

export interface KernelDigest {
  direction: DirectionType;
  mode: ModeType;
  finalSize: number;
  
  consensusIndex: number;
  conflictLevel: 'NONE' | 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  structuralLock: boolean;
  timingOverrideBlocked: boolean;
  
  dominance: TierType;
  volRegime: string;
  
  phaseType: string;
  phaseGrade: GradeType;
  
  divergenceScore: number;
  divergenceGrade: GradeType;
  
  primaryMatchId: string | null;
  primaryMatchScore: number;
}

export interface HorizonVote {
  horizon: FocusHorizon;
  tier: TierType;
  direction: 'BULLISH' | 'BEARISH' | 'FLAT';
  weight: number;
  contribution: number;
  confidence: number;
  entropy: number;
  blockers: string[];
}

export interface TierWeights {
  structureWeightSum: number;
  tacticalWeightSum: number;
  timingWeightSum: number;
  structuralDirection: 'BULLISH' | 'BEARISH' | 'FLAT';
  tacticalDirection: 'BULLISH' | 'BEARISH' | 'FLAT';
  timingDirection: 'BULLISH' | 'BEARISH' | 'FLAT';
}

export interface PredictionSnapshotDocument extends Document {
  symbol: 'BTC';
  asofDate: string;           // YYYY-MM-DD (UTC close date)
  focus: FocusHorizon;
  role: SnapshotRole;
  preset: SnapshotPreset;
  
  // BLOCK 77.4: Data source isolation
  source: DataSourceType;     // 'LIVE' | 'BOOTSTRAP'
  policyHash: string;         // Hash of policy that generated this snapshot
  engineVersion: string;      // e.g., 'v2.1.0'
  
  // BLOCK 77.6: Cohort isolation (V2014 vs V2020 vs LIVE)
  cohort: CohortType;         // 'LIVE' | 'V2020' | 'V2014'
  rangeTag?: string;          // e.g., '2014-2019' | '2020-2025'
  
  // Bootstrap metadata (only for source='BOOTSTRAP')
  bootstrapMeta?: {
    rangeFrom: string;        // e.g., '2020-01-01'
    rangeTo: string;          // e.g., '2025-12-31'
    generatedAt: string;      // When bootstrap was run
    batchId: string;          // Batch identifier
  };
  
  tier: TierType;
  maturityDate: string;       // asofDate + focus horizon
  
  kernelDigest: KernelDigest;
  
  // BLOCK 74 data
  horizonVotes: HorizonVote[];
  tierWeights: TierWeights;
  
  // Expected outcome distribution
  distribution?: {
    p10: number;
    p50: number;
    p90: number;
    expectedReturn: number;
  };
  
  // Full terminal payload (for replay/audit)
  terminalPayload: Record<string, any>;
  
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const HorizonVoteSchema = new Schema({
  horizon: { type: String, enum: ['7d', '14d', '30d', '90d', '180d', '365d'], required: true },
  tier: { type: String, enum: ['TIMING', 'TACTICAL', 'STRUCTURE'], required: true },
  direction: { type: String, enum: ['BULLISH', 'BEARISH', 'FLAT'], required: true },
  weight: { type: Number, required: true },
  contribution: { type: Number, required: true },
  confidence: { type: Number, default: 0 },
  entropy: { type: Number, default: 0 },
  blockers: [{ type: String }]
}, { _id: false });

const TierWeightsSchema = new Schema({
  structureWeightSum: { type: Number, required: true },
  tacticalWeightSum: { type: Number, required: true },
  timingWeightSum: { type: Number, required: true },
  structuralDirection: { type: String, enum: ['BULLISH', 'BEARISH', 'FLAT'], required: true },
  tacticalDirection: { type: String, enum: ['BULLISH', 'BEARISH', 'FLAT'], required: true },
  timingDirection: { type: String, enum: ['BULLISH', 'BEARISH', 'FLAT'], required: true }
}, { _id: false });

const KernelDigestSchema = new Schema({
  direction: { type: String, enum: ['BUY', 'SELL', 'HOLD'], required: true },
  mode: { type: String, enum: ['TREND_FOLLOW', 'COUNTER_TREND', 'NO_TRADE', 'WAIT'], required: true },
  finalSize: { type: Number, required: true },
  
  consensusIndex: { type: Number, required: true },
  conflictLevel: { type: String, enum: ['NONE', 'LOW', 'MODERATE', 'HIGH', 'SEVERE'], required: true },
  structuralLock: { type: Boolean, required: true },
  timingOverrideBlocked: { type: Boolean, default: false },
  
  dominance: { type: String, enum: ['TIMING', 'TACTICAL', 'STRUCTURE'], required: true },
  volRegime: { type: String, required: true },
  
  phaseType: { type: String, default: 'UNKNOWN' },
  phaseGrade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], default: 'C' },
  
  divergenceScore: { type: Number, default: 0 },
  divergenceGrade: { type: String, enum: ['A', 'B', 'C', 'D', 'F'], default: 'C' },
  
  primaryMatchId: { type: String, default: null },
  primaryMatchScore: { type: Number, default: 0 }
}, { _id: false });

const DistributionSchema = new Schema({
  p10: { type: Number },
  p50: { type: Number },
  p90: { type: Number },
  expectedReturn: { type: Number }
}, { _id: false });

// BLOCK 77.4: Bootstrap metadata schema
const BootstrapMetaSchema = new Schema({
  rangeFrom: { type: String },
  rangeTo: { type: String },
  generatedAt: { type: String },
  batchId: { type: String }
}, { _id: false });

const PredictionSnapshotSchema = new Schema<PredictionSnapshotDocument>(
  {
    symbol: { type: String, enum: ['BTC'], required: true },
    asofDate: { type: String, required: true },
    focus: { 
      type: String, 
      enum: ['7d', '14d', '30d', '90d', '180d', '365d'], 
      required: true 
    },
    role: { type: String, enum: ['ACTIVE', 'SHADOW'], required: true },
    preset: { 
      type: String, 
      enum: ['conservative', 'balanced', 'aggressive'], 
      required: true 
    },
    
    // BLOCK 77.4: Data source isolation fields
    source: { 
      type: String, 
      enum: ['LIVE', 'BOOTSTRAP'], 
      required: true,
      default: 'LIVE'
    },
    policyHash: { type: String, required: true, default: 'v2.1.0' },
    engineVersion: { type: String, required: true, default: 'v2.1.0' },
    
    // BLOCK 77.6: Cohort isolation
    cohort: {
      type: String,
      enum: ['LIVE', 'V2020', 'V2014'],
      required: true,
      default: 'LIVE'
    },
    rangeTag: { type: String },
    
    bootstrapMeta: { type: BootstrapMetaSchema },
    
    tier: { type: String, enum: ['TIMING', 'TACTICAL', 'STRUCTURE'], required: true },
    maturityDate: { type: String, required: true },
    
    kernelDigest: { type: KernelDigestSchema, required: true },
    horizonVotes: [HorizonVoteSchema],
    tierWeights: { type: TierWeightsSchema, required: true },
    
    distribution: { type: DistributionSchema },
    
    terminalPayload: { type: Schema.Types.Mixed, required: true }
  },
  { timestamps: true }
);

/**
 * UNIQUE: One prediction snapshot per (symbol, asofDate, focus, role, preset, source, cohort)
 * BLOCK 77.4: Added source to allow LIVE and BOOTSTRAP records for same date
 * BLOCK 77.6: Added cohort for V2014 vs V2020 isolation
 */
PredictionSnapshotSchema.index(
  { symbol: 1, asofDate: 1, focus: 1, role: 1, preset: 1, source: 1, cohort: 1 },
  { unique: true }
);

/**
 * Query index for finding matured snapshots
 */
PredictionSnapshotSchema.index({ symbol: 1, maturityDate: 1 });

/**
 * Query index for date range
 */
PredictionSnapshotSchema.index({ symbol: 1, asofDate: 1 });

/**
 * BLOCK 77.4: Query index by source (LIVE vs BOOTSTRAP)
 */
PredictionSnapshotSchema.index({ source: 1, symbol: 1, asofDate: 1 });

/**
 * BLOCK 77.4: Query index by policyHash for re-simulation
 */
PredictionSnapshotSchema.index({ policyHash: 1, source: 1 });

/**
 * BLOCK 77.6: Query index by cohort for vintage analysis
 */
PredictionSnapshotSchema.index({ cohort: 1, symbol: 1, asofDate: 1 });

/**
 * BLOCK 77.6: Compound index for attribution by source + cohort
 */
PredictionSnapshotSchema.index({ source: 1, cohort: 1, symbol: 1, focus: 1 });

export const PredictionSnapshotModel = 
  mongoose.models.FractalPredictionSnapshot ||
  mongoose.model<PredictionSnapshotDocument>('FractalPredictionSnapshot', PredictionSnapshotSchema);
