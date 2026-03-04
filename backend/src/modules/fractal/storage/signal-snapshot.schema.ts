/**
 * BLOCK 56.2 — SignalSnapshot Schema
 * 
 * Institutional-grade snapshot contract for:
 * - Backtest (historical replay)
 * - Lifecycle (rolling metrics)
 * - MetaBrain (decision input)
 * - Audit (compliance tracking)
 * 
 * Supports ACTIVE + SHADOW models for A/B comparison.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type ModelType = 'ACTIVE' | 'SHADOW' | 'CANDIDATE' | 'ARCHIVED';
export type ActionType = 'LONG' | 'SHORT' | 'HOLD';
export type GuardMode = 'NORMAL' | 'PROTECTION' | 'FROZEN' | 'HALT';
export type HealthStatus = 'HEALTHY' | 'WATCH' | 'ALERT' | 'CRITICAL';
export type SignalSource = 'LIVE' | 'REPLAY' | 'ENGINE_ASOF';
export type StrategyPreset = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
export type StrategyMode = 'NO_TRADE' | 'MICRO' | 'PARTIAL' | 'FULL' | 'ENTER' | 'REDUCE' | 'EXIT';

// SEED SUPPORT: origin field for filtering seed vs live data
export type DataOrigin = 'live' | 'seed_backtest';

export interface OutcomeData {
  realizedReturn: number;
  hit: boolean;
  resolvedAt: Date;
  closeAsof: number;
  closeForward: number;
}

export interface SignalSnapshotDocument extends Document {
  // Identity
  symbol: string;
  asOf: Date;
  timeframe: '1D';
  version: string;
  modelId: string;
  modelType: ModelType;
  
  // Core Signal
  action: ActionType;
  dominantHorizon: 7 | 14 | 30;
  expectedReturn: number;
  confidence: number;
  reliability: number;
  entropy: number;
  stability: number;
  
  // Risk
  risk: {
    maxDD_WF: number;
    mcP95_DD: number;
    softStop: number;
  };
  
  // Strategy Layer
  strategy: {
    preset: StrategyPreset;
    minConf: number;
    maxEntropy: number;
    maxTail: number;
    positionSize: number;
    mode: StrategyMode;
    edgeScore: number;
  };
  
  // Diagnostics
  metrics: {
    similarityMean: number;
    effectiveN: number;
    matchCount: number;
  };
  
  // Market phase (for performance analysis)
  phase?: 'MARKUP' | 'MARKDOWN' | 'RECOVERY' | 'ACCUMULATION' | 'CAPITULATION' | 'DISTRIBUTION' | 'UNKNOWN';
  
  // Governance
  governance: {
    guardMode: GuardMode;
    healthStatus: HealthStatus;
  };
  
  // BLOCK 56.3: Outcomes (resolved after T+7/14/30)
  outcomes?: {
    '7d'?: OutcomeData;
    '14d'?: OutcomeData;
    '30d'?: OutcomeData;
  };
  resolved: boolean;
  
  // Meta
  source: SignalSource;
  createdAt: Date;
  
  // SEED SUPPORT: fields for filtering and tracking seed vs live data
  origin?: DataOrigin;           // 'live' | 'seed_backtest' (defaults to 'live')
  seedRunId?: string;            // unique ID for the seed batch
  asOfTs?: Date;                 // virtual "now" for backtest (when origin=seed_backtest)
}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const SignalSnapshotSchema = new Schema<SignalSnapshotDocument>({
  // Identity
  symbol: { type: String, required: true, index: true },
  asOf: { type: Date, required: true, index: true },
  timeframe: { type: String, default: '1D', enum: ['1D'] },
  version: { type: String, required: true },
  modelId: { type: String, required: true },
  modelType: { type: String, required: true, enum: ['ACTIVE', 'SHADOW', 'CANDIDATE', 'ARCHIVED'] },
  
  // Core Signal
  action: { type: String, required: true, enum: ['LONG', 'SHORT', 'HOLD'] },
  dominantHorizon: { type: Number, required: true, enum: [7, 14, 30] },
  expectedReturn: { type: Number, required: true },
  confidence: { type: Number, required: true },
  reliability: { type: Number, required: true },
  entropy: { type: Number, required: true },
  stability: { type: Number, required: true },
  
  // Risk
  risk: {
    maxDD_WF: { type: Number, required: true },
    mcP95_DD: { type: Number, required: true },
    softStop: { type: Number, required: true }
  },
  
  // Strategy Layer
  strategy: {
    preset: { type: String, required: true, enum: ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'] },
    minConf: { type: Number, required: true },
    maxEntropy: { type: Number, required: true },
    maxTail: { type: Number, required: true },
    positionSize: { type: Number, required: true },
    mode: { type: String, required: true, enum: ['NO_TRADE', 'MICRO', 'PARTIAL', 'FULL', 'ENTER', 'REDUCE', 'EXIT'] },
    edgeScore: { type: Number, required: true }
  },
  
  // Diagnostics
  metrics: {
    similarityMean: { type: Number, default: 0 },
    effectiveN: { type: Number, default: 0 },
    matchCount: { type: Number, default: 0 }
  },
  
  // Market phase (for performance analysis)
  phase: { 
    type: String, 
    enum: ['MARKUP', 'MARKDOWN', 'RECOVERY', 'ACCUMULATION', 'CAPITULATION', 'DISTRIBUTION', 'UNKNOWN'],
    default: 'UNKNOWN'
  },
  
  // Governance
  governance: {
    guardMode: { type: String, default: 'NORMAL', enum: ['NORMAL', 'PROTECTION', 'FROZEN', 'HALT'] },
    healthStatus: { type: String, default: 'HEALTHY', enum: ['HEALTHY', 'WATCH', 'ALERT', 'CRITICAL'] }
  },
  
  // BLOCK 56.3: Outcomes (resolved after T+7/14/30)
  outcomes: {
    '7d': {
      realizedReturn: { type: Number },
      hit: { type: Boolean },
      resolvedAt: { type: Date },
      closeAsof: { type: Number },
      closeForward: { type: Number }
    },
    '14d': {
      realizedReturn: { type: Number },
      hit: { type: Boolean },
      resolvedAt: { type: Date },
      closeAsof: { type: Number },
      closeForward: { type: Number }
    },
    '30d': {
      realizedReturn: { type: Number },
      hit: { type: Boolean },
      resolvedAt: { type: Date },
      closeAsof: { type: Number },
      closeForward: { type: Number }
    }
  },
  resolved: { type: Boolean, default: false },
  
  // Meta
  source: { type: String, required: true, enum: ['LIVE', 'REPLAY', 'ENGINE_ASOF'] },
  createdAt: { type: Date, default: Date.now },
  
  // SEED SUPPORT: fields for filtering and tracking seed vs live data
  origin: { type: String, enum: ['live', 'seed_backtest'], default: 'live', index: true },
  seedRunId: { type: String, index: true, sparse: true },
  asOfTs: { type: Date }
}, {
  collection: 'fractal_signal_snapshots',
  timestamps: false
});

// Unique compound index: (symbol, asOf, modelType, preset)
SignalSnapshotSchema.index({ symbol: 1, asOf: 1, modelType: 1, 'strategy.preset': 1 }, { unique: true });

// Query indexes
SignalSnapshotSchema.index({ modelType: 1, createdAt: -1 });
SignalSnapshotSchema.index({ symbol: 1, modelType: 1, asOf: -1 });

export const SignalSnapshotModel = mongoose.model<SignalSnapshotDocument>(
  'FractalSignalSnapshot',
  SignalSnapshotSchema
);

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Create or update a signal snapshot (upsert)
 */
export async function upsertSignalSnapshot(
  snapshot: Omit<SignalSnapshotDocument, '_id' | 'createdAt'>
): Promise<void> {
  await SignalSnapshotModel.updateOne(
    {
      symbol: snapshot.symbol,
      asOf: snapshot.asOf,
      modelType: snapshot.modelType
    },
    {
      $set: {
        ...snapshot,
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
}

/**
 * Get snapshots for a date range
 * @param includeSeed - if true, includes seed_backtest data; default false (live only)
 */
export async function getSnapshots(
  symbol: string,
  modelType: ModelType,
  from: Date,
  to: Date,
  includeSeed: boolean = false
): Promise<SignalSnapshotDocument[]> {
  const filter: any = {
    symbol,
    modelType,
    asOf: { $gte: from, $lte: to }
  };
  
  // SEED FILTER: by default only live data
  if (!includeSeed) {
    filter.$or = [
      { origin: 'live' },
      { origin: { $exists: false } }  // legacy docs without origin field
    ];
  }
  
  return SignalSnapshotModel.find(filter).sort({ asOf: 1 }).lean();
}

/**
 * Get latest snapshot
 */
export async function getLatestSnapshot(
  symbol: string,
  modelType: ModelType
): Promise<SignalSnapshotDocument | null> {
  return SignalSnapshotModel.findOne({
    symbol,
    modelType
  }).sort({ asOf: -1 }).lean();
}

/**
 * Count snapshots
 * @param includeSeed - if true, includes seed_backtest data
 */
export async function countSnapshots(
  symbol: string,
  modelType: ModelType,
  includeSeed: boolean = false
): Promise<number> {
  const filter: any = { symbol, modelType };
  
  if (!includeSeed) {
    filter.$or = [
      { origin: 'live' },
      { origin: { $exists: false } }
    ];
  }
  
  return SignalSnapshotModel.countDocuments(filter);
}
