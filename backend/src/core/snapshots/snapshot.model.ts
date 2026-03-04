/**
 * ETAP 6.3 — Snapshot Model
 * 
 * MongoDB model for signal snapshots.
 * Key: { window, snapshotAt }
 * 
 * Snapshots are IMMUTABLE (append-only).
 * Engine reads ONLY from snapshots.
 * 
 * P1.4 Enhanced: coverage, stability, viability
 */
import mongoose from 'mongoose';
import type { SignalSnapshot, SnapshotActor, SnapshotEdge, SnapshotStats, SnapshotWindow } from './snapshot.types.js';

export interface ISignalSnapshotDocument extends mongoose.Document {
  snapshotId: string;
  window: SnapshotWindow;
  snapshotAt: Date;
  
  actors: SnapshotActor[];
  edges: SnapshotEdge[];
  
  stats: SnapshotStats;
  
  // P1.4 fields
  coverage?: {
    actorsCoveragePct: number;
    edgesCoveragePct: number;
    transfersCoveredPct: number;
  };
  stability?: {
    snapshotHash: string;
    deltaFromPrev?: number;
    isStable: boolean;
    quality: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  isViable?: boolean;
  
  createdAt: Date;
}

const SnapshotActorSchema = new mongoose.Schema({
  actorId: { type: String, required: true },
  name: { type: String },
  type: { type: String },
  
  inflow_usd: { type: Number, default: 0 },
  outflow_usd: { type: Number, default: 0 },
  net_flow_usd: { type: Number, default: 0 },
  tx_count: { type: Number, default: 0 },
  
  participation_trend: { 
    type: String, 
    enum: ['increasing', 'stable', 'decreasing'],
    default: 'stable',
  },
  burst_score: { type: Number, default: 0 },
  
  coverage: { type: Number, default: 0 },
  
  // P1.4: Direction metrics
  direction_ratio: { type: Number },
  imbalance_score: { type: Number },
}, { _id: false });

const SnapshotEdgeSchema = new mongoose.Schema({
  sourceId: { type: String, required: true },
  targetId: { type: String, required: true },
  edgeType: { 
    type: String, 
    enum: ['flow', 'bridge', 'corridor'],
    default: 'flow',
  },
  
  weight: { type: Number, default: 0 },
  confidence: { type: Number, default: 0 },
  direction_balance: { type: Number, default: 0 },
  evidence_count: { type: Number, default: 0 },
}, { _id: false });

const SnapshotStatsSchema = new mongoose.Schema({
  actorCount: { type: Number, default: 0 },
  edgeCount: { type: Number, default: 0 },
  totalVolume: { type: Number, default: 0 },
  avgBurstScore: { type: Number, default: 0 },
}, { _id: false });

// P1.4: Coverage schema
const CoverageSchema = new mongoose.Schema({
  actorsCoveragePct: { type: Number, default: 0 },
  edgesCoveragePct: { type: Number, default: 0 },
  transfersCoveredPct: { type: Number, default: 0 },
}, { _id: false });

// P1.4: Stability schema
const StabilitySchema = new mongoose.Schema({
  snapshotHash: { type: String },
  deltaFromPrev: { type: Number },
  isStable: { type: Boolean, default: true },
  quality: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'], default: 'MEDIUM' },
}, { _id: false });

const SignalSnapshotSchema = new mongoose.Schema<ISignalSnapshotDocument>({
  snapshotId: {
    type: String,
    required: true,
    unique: true,
  },
  window: {
    type: String,
    required: true,
    enum: ['24h', '7d', '30d'],
  },
  snapshotAt: {
    type: Date,
    required: true,
  },
  
  actors: [SnapshotActorSchema],
  edges: [SnapshotEdgeSchema],
  
  stats: SnapshotStatsSchema,
  
  // P1.4 fields
  coverage: CoverageSchema,
  stability: StabilitySchema,
  isViable: { type: Boolean, default: true },
  
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'signal_snapshots',
  timestamps: false,
});

// Query indexes
SignalSnapshotSchema.index({ window: 1, snapshotAt: -1 });
SignalSnapshotSchema.index({ window: 1, createdAt: -1 });
SignalSnapshotSchema.index({ isViable: 1, window: 1 }); // P1.4

export const SignalSnapshotModel = mongoose.model<ISignalSnapshotDocument>(
  'SignalSnapshot',
  SignalSnapshotSchema
);
