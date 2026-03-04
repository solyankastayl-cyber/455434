/**
 * EPIC D1 — Engine Signals MongoDB Model
 */
import mongoose, { Schema, Document } from 'mongoose';
import type { D1Signal, D1SignalRun } from './d1_signal.types.js';

// Signal Schema
const EntityRefSchema = new Schema({
  kind: { type: String, enum: ['actor', 'entity', 'wallet'], required: true },
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: String,
  source: String,
  coverage: Number
}, { _id: false });

const EvidenceEdgeSchema = new Schema({
  edgeId: String,
  from: EntityRefSchema,
  to: EntityRefSchema,
  edgeType: String,
  confidence: { type: String, enum: ['low', 'medium', 'high'] },
  weight: Number,
  direction: { type: String, enum: ['inflow', 'outflow', 'bidirectional', 'neutral'] },
  density: Number,
  why: String
}, { _id: false });

const EvidenceSchema = new Schema({
  rule: {
    name: { type: String, required: true },
    version: { type: String, default: '1.0' },
    thresholds: Schema.Types.Mixed
  },
  baseline: {
    density: Number,
    weight: Number,
    direction: { type: String, enum: ['inflow', 'outflow', 'bidirectional', 'neutral'] },
    window: String
  },
  current: {
    density: Number,
    weight: Number,
    direction: { type: String, enum: ['inflow', 'outflow', 'bidirectional', 'neutral'] },
    window: String
  },
  persistence: {
    hours: Number,
    firstSeenAt: Date
  },
  flows: {
    inflowUsd: Number,
    outflowUsd: Number,
    netUsd: Number
  },
  regime: {
    previous: String,
    current: String,
    confidence: Number
  },
  topEdges: [EvidenceEdgeSchema]
}, { _id: false });

const MetricsSchema = new Schema({
  density: {
    current: Number,
    previous: Number,
    deltaPct: Number
  },
  inflowUsd: Number,
  outflowUsd: Number,
  netFlowRatio: Number,
  edgesCount: Number
}, { _id: false });

const D1SignalSchema = new Schema<D1Signal & Document>({
  id: { type: String, required: true, unique: true, index: true },
  type: { 
    type: String, 
    enum: ['NEW_CORRIDOR', 'DENSITY_SPIKE', 'DIRECTION_IMBALANCE', 'ACTOR_REGIME_CHANGE', 'NEW_BRIDGE', 'CLUSTER_RECONFIGURATION'],
    required: true,
    index: true
  },
  scope: { 
    type: String, 
    enum: ['actor', 'entity', 'wallet', 'cluster', 'corridor'],
    required: true,
    index: true
  },
  status: { 
    type: String, 
    enum: ['new', 'active', 'cooling', 'archived'],
    default: 'new',
    index: true
  },
  severity: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    required: true,
    index: true
  },
  confidence: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  window: { 
    type: String, 
    enum: ['24h', '7d', '30d'],
    required: true,
    index: true
  },
  
  // Content
  title: { type: String, required: true },
  subtitle: String,
  disclaimer: { type: String, default: 'Structural alert based on observed on-chain activity. Not predictive. Not trading advice.' },
  
  // Entities
  primary: EntityRefSchema,
  secondary: EntityRefSchema,
  entities: [EntityRefSchema],
  
  // Direction & metrics
  direction: { type: String, enum: ['inflow', 'outflow', 'bidirectional', 'neutral'] },
  metrics: MetricsSchema,
  
  // Tags
  tags: [String],
  
  // Evidence
  evidence: EvidenceSchema,
  
  // Summary
  summary: {
    what: String,
    whyNow: String,
    soWhat: String
  },
  
  // Links
  links: {
    graph: String,
    primary: String,
    secondary: String
  },
  
  // Run tracking (ETAP 6.4)
  runId: String,
  snapshotId: { type: String, index: true },  // MUST have snapshotId
  signalKey: { type: String, index: true },   // Stable hash for deduplication
  
  // Confidence (ETAP 7)
  confidenceScore: { type: Number, default: 0 },
  confidenceLabel: { 
    type: String, 
    enum: ['HIGH', 'MEDIUM', 'LOW', 'HIDDEN'],
    default: 'MEDIUM'
  },
  confidenceBreakdown: {
    coverage: { type: Number, default: 0 },
    actors: { type: Number, default: 0 },
    flow: { type: Number, default: 0 },
    temporal: { type: Number, default: 0 },
    evidence: { type: Number, default: 0 },
  },
  confidenceReasons: [String],
  
  // P1: Lifecycle State Machine
  lifecycleStatus: {
    type: String,
    enum: ['NEW', 'ACTIVE', 'COOLDOWN', 'RESOLVED'],
    default: 'NEW',
    index: true
  },
  firstTriggeredAt: { type: Date },
  lastTriggeredAt: { type: Date },
  snapshotsWithoutTrigger: { type: Number, default: 0 },
  resolveReason: { 
    type: String, 
    enum: ['inactivity', 'confidence_drop', 'invalidated', 'manual'],
  },
  
  // P1.5: Confidence Trace (explainability)
  confidenceTrace: {
    baseScore: Number,
    actorScore: Number,
    coverageScore: Number,
    flowScore: Number,
    temporalScore: Number,
    evidenceScore: Number,
    penalties: [{
      type: { type: String },
      reason: String,
      multiplier: Number,
      impact: Number
    }],
    decayApplied: Boolean,
    decayFactor: Number,
    hoursElapsed: Number,
    cappedByActorGuard: Boolean,
    capValue: Number,
    calculatedAt: Date
  },
}, {
  timestamps: true,
  collection: 'd1_engine_signals'
});

// Indexes for efficient queries
D1SignalSchema.index({ createdAt: -1 });
D1SignalSchema.index({ status: 1, window: 1, createdAt: -1 });
D1SignalSchema.index({ type: 1, status: 1 });
D1SignalSchema.index({ severity: 1, status: 1 });
D1SignalSchema.index({ 'entities.id': 1 });
D1SignalSchema.index({ 'primary.id': 1 });
D1SignalSchema.index({ 'secondary.id': 1 });
D1SignalSchema.index({ signalKey: 1, window: 1 }, { unique: true, sparse: true });  // Idempotent
D1SignalSchema.index({ confidenceLabel: 1, severity: 1 });  // ETAP 7: Filter by confidence
D1SignalSchema.index({ lifecycleStatus: 1, lastTriggeredAt: -1 });  // P1: Lifecycle queries

// Signal Run Schema (for tracking engine runs)
const D1SignalRunSchema = new Schema<D1SignalRun & Document>({
  runId: { type: String, required: true, unique: true, index: true },
  window: { type: String, enum: ['24h', '7d', '30d'], required: true },
  snapshotId: { type: String, index: true },  // ETAP 6.4: track which snapshot was used
  startedAt: { type: Date, required: true },
  completedAt: Date,
  status: { type: String, enum: ['running', 'completed', 'failed'], default: 'running' },
  stats: {
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    archived: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    errors: { type: Number, default: 0 }
  },
  error: String
}, {
  timestamps: true,
  collection: 'd1_signal_runs'
});

D1SignalRunSchema.index({ startedAt: -1 });

export const D1SignalModel = mongoose.model<D1Signal & Document>('D1Signal', D1SignalSchema);
export const D1SignalRunModel = mongoose.model<D1SignalRun & Document>('D1SignalRun', D1SignalRunSchema);
