/**
 * Prediction Snapshot Model
 * 
 * Captures the state of a prediction at decision time.
 * IMMUTABLE - created once, never modified.
 * 
 * Source of truth: "what the system knew when it made the decision"
 */
import mongoose from 'mongoose';
import type { 
  Bucket, 
  DriftLevel,
  TokenInfo,
  DecisionState,
  EngineContext,
  LiveContext,
  MarketState,
} from '../learning.types.js';

export interface IPredictionSnapshot {
  // Unique identifier
  snapshotId: string;
  
  // Token info
  token: TokenInfo;
  
  // Decision state
  decision: DecisionState;
  
  // Engine context
  engineContext: EngineContext;
  
  // LIVE context
  liveContext: LiveContext;
  
  // Market state at decision
  market: MarketState;
  
  // Timestamp
  decidedAt: Date;
  createdAt: Date;
}

const TokenInfoSchema = new mongoose.Schema({
  address: { type: String, required: true, lowercase: true },
  symbol: { type: String, required: true },
}, { _id: false });

const DecisionStateSchema = new mongoose.Schema({
  bucket: { type: String, enum: ['BUY', 'WATCH', 'SELL'], required: true },
  score: { type: Number, required: true },
  confidence: { type: Number, required: true },
  risk: { type: Number, required: true, default: 0 },
}, { _id: false });

const EngineContextSchema = new mongoose.Schema({
  engineVersion: { type: String, required: true, default: 'v2' },
  engineMode: { type: String, enum: ['rules', 'rules_with_actors'], required: true, default: 'rules_with_actors' },
  actorSignalScore: { type: Number, required: true, default: 0 },
}, { _id: false });

const LiveContextSchema = new mongoose.Schema({
  driftLevel: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], required: true, default: 'LOW' },
  driftScore: { type: Number, required: true, default: 0 },
}, { _id: false });

const MarketStateSchema = new mongoose.Schema({
  priceAtDecision: { type: Number, required: true },
  volumeAtDecision: { type: Number, required: true, default: 0 },
  marketCapAtDecision: { type: Number, required: false },
}, { _id: false });

const PredictionSnapshotSchema = new mongoose.Schema<IPredictionSnapshot>({
  snapshotId: {
    type: String,
    required: true,
    unique: true,
  },
  token: {
    type: TokenInfoSchema,
    required: true,
  },
  decision: {
    type: DecisionStateSchema,
    required: true,
  },
  engineContext: {
    type: EngineContextSchema,
    required: true,
  },
  liveContext: {
    type: LiveContextSchema,
    required: true,
  },
  market: {
    type: MarketStateSchema,
    required: true,
  },
  decidedAt: {
    type: Date,
    required: true,
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
}, {
  collection: 'prediction_snapshots',
  timestamps: false,
});

// Indexes
PredictionSnapshotSchema.index({ snapshotId: 1 }, { unique: true });
PredictionSnapshotSchema.index({ 'token.address': 1, decidedAt: -1 });
PredictionSnapshotSchema.index({ decidedAt: -1 });
PredictionSnapshotSchema.index({ 'decision.bucket': 1 });

export const PredictionSnapshotModel = mongoose.model<IPredictionSnapshot>(
  'PredictionSnapshot',
  PredictionSnapshotSchema
);
