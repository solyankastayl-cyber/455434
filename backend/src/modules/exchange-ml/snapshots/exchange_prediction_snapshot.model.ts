/**
 * Exchange Prediction Snapshot Model (BLOCK 1)
 * 
 * Immutable ledger of all ML predictions.
 * Each snapshot represents a single prediction at a point in time.
 * 
 * CRITICAL: Snapshots are NEVER updated after creation.
 * - ACTIVE: Current prediction for this symbol/horizon
 * - ARCHIVED: Previous predictions (superseded by new ACTIVE)
 * - RESOLVED: Prediction has been evaluated (WIN/LOSS determined)
 * 
 * Only ONE ACTIVE snapshot per (symbol, horizon) at any time.
 */

import { Schema, model, models, Document, Model } from 'mongoose';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SnapshotStatus = 'ACTIVE' | 'ARCHIVED' | 'RESOLVED';
export type SnapshotOutcome = 'WIN' | 'LOSS' | 'NEUTRAL' | null;

export interface ExchangePredictionSnapshot {
  _id?: string;
  
  // Unique identifier
  snapshotId: string;
  
  // Prediction target
  symbol: string;
  horizon: ExchangeHorizon;
  
  // Model information (immutable binding)
  modelId: string;
  modelVersion: number;
  retrainBatchId?: string;           // Links to specific training batch
  
  // Prediction data
  prediction: number;                 // Raw probability (0..1)
  predictedClass: 'WIN' | 'LOSS';
  confidence: number;                 // Adjusted confidence after bias
  
  // Cross-horizon bias applied (if any)
  biasModifier?: number;
  biasBreakdown?: {
    fromParentHorizon?: string;
    parentBias?: number;
    weightedInfluence?: number;
    decayState?: string;
  };
  
  // Entry conditions
  entryPrice: number;
  entryTimestamp: Date;
  
  // Status lifecycle
  status: SnapshotStatus;
  
  // Resolution (filled when status → RESOLVED)
  outcome?: SnapshotOutcome;
  exitPrice?: number;
  exitTimestamp?: Date;
  priceChangePercent?: number;
  
  // Metadata
  createdAt: Date;
  archivedAt?: Date;
  resolvedAt?: Date;
  
  // Audit trail
  previousSnapshotId?: string;        // Links to the snapshot this replaced
}

export interface ExchangePredictionSnapshotDocument extends ExchangePredictionSnapshot, Document {}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const ExchangePredictionSnapshotSchema = new Schema<ExchangePredictionSnapshotDocument>({
  snapshotId: {
    type: String,
    required: true,
    unique: true,
  },
  
  // Prediction target
  symbol: { type: String, required: true },
  horizon: {
    type: String,
    required: true,
    enum: ['1D', '7D', '30D'],
  },
  
  // Model binding
  modelId: { type: String, required: true },
  modelVersion: { type: Number, required: true },
  retrainBatchId: { type: String },
  
  // Prediction data
  prediction: { type: Number, required: true },
  predictedClass: {
    type: String,
    required: true,
    enum: ['WIN', 'LOSS'],
  },
  confidence: { type: Number, required: true },
  
  // Bias
  biasModifier: { type: Number },
  biasBreakdown: {
    type: Schema.Types.Mixed,
    default: null,
  },
  
  // Entry
  entryPrice: { type: Number, required: true },
  entryTimestamp: { type: Date, required: true },
  
  // Status
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'ARCHIVED', 'RESOLVED'],
    default: 'ACTIVE',
  },
  
  // Resolution
  outcome: {
    type: String,
    enum: ['WIN', 'LOSS', 'NEUTRAL', null],
    default: null,
  },
  exitPrice: { type: Number },
  exitTimestamp: { type: Date },
  priceChangePercent: { type: Number },
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  archivedAt: { type: Date },
  resolvedAt: { type: Date },
  
  // Audit
  previousSnapshotId: { type: String },
}, {
  timestamps: false,
  collection: 'exchange_prediction_snapshots',
});

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

// Primary lookup: find ACTIVE snapshot for a symbol/horizon
// Partial unique index: only ONE active per symbol+horizon
ExchangePredictionSnapshotSchema.index(
  { symbol: 1, horizon: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' } }
);

// Lookup by snapshotId
ExchangePredictionSnapshotSchema.index({ snapshotId: 1 }, { unique: true });

// Timeline queries
ExchangePredictionSnapshotSchema.index({ symbol: 1, horizon: 1, createdAt: -1 });
ExchangePredictionSnapshotSchema.index({ horizon: 1, status: 1, createdAt: -1 });

// Resolution queries
ExchangePredictionSnapshotSchema.index({ status: 1, entryTimestamp: 1 });
ExchangePredictionSnapshotSchema.index({ horizon: 1, outcome: 1 });

// Model binding queries
ExchangePredictionSnapshotSchema.index({ modelId: 1, modelVersion: 1 });
ExchangePredictionSnapshotSchema.index({ retrainBatchId: 1 });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export const ExchangePredictionSnapshotModel: Model<ExchangePredictionSnapshotDocument> =
  models.ExchangePredictionSnapshot ||
  model<ExchangePredictionSnapshotDocument>('ExchangePredictionSnapshot', ExchangePredictionSnapshotSchema);

console.log('[Exchange ML] Prediction Snapshot model loaded');
