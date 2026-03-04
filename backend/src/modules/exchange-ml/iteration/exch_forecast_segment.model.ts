/**
 * Exchange Forecast Segment Model (BLOCK 5.1)
 * 
 * Each new prediction = separate model iteration segment.
 * No redrawing of old data. True ML versioning.
 * 
 * Status lifecycle:
 * - ACTIVE: Current prediction segment
 * - SUPERSEDED: Replaced by new segment (shown as gray)
 * - RESOLVED: Outcome determined
 */

import { Schema, model, models, Document, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ExchHorizon = '1D' | '7D' | '30D';
export type ExchDriftState = 'NORMAL' | 'WARNING' | 'CRITICAL';
export type ExchSegmentStatus = 'ACTIVE' | 'SUPERSEDED' | 'RESOLVED';

export interface ExchForecastSegment {
  _id?: string;
  
  // Target
  asset: string;           // BTC, ETH...
  horizon: ExchHorizon;
  
  // Identification
  segmentId: string;       // UUID
  modelVersion: string;    // exchange_v4.4_xxx
  
  // Timestamps
  createdAt: Date;
  supersededAt?: Date | null;
  resolvedAt?: Date | null;
  
  // Price data
  entryPrice: number;
  targetPrice: number;
  expectedReturn: number;  // 0.0881 = +8.81%
  
  // Model state at creation
  confidence: number;      // 0..1
  biasApplied: number;     // -1..+1
  driftState: ExchDriftState;
  
  // Status
  status: ExchSegmentStatus;
  
  // Roll reason (why this segment was created)
  rollReason?: 'MODEL_VERSION_CHANGED' | 'BIAS_CROSSED' | 'MANUAL' | 'SCHEDULED' | 'INITIAL';
  
  // Outcome (filled when RESOLVED)
  outcome?: 'WIN' | 'LOSS' | 'NEUTRAL';
  actualReturn?: number;
}

export interface ExchForecastSegmentDocument extends ExchForecastSegment, Document {}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const ExchForecastSegmentSchema = new Schema<ExchForecastSegmentDocument>({
  asset: { type: String, required: true },
  horizon: {
    type: String,
    required: true,
    enum: ['1D', '7D', '30D'],
  },
  
  segmentId: { type: String, required: true },
  modelVersion: { type: String, required: true },
  
  createdAt: { type: Date, required: true },
  supersededAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  
  entryPrice: { type: Number, required: true },
  targetPrice: { type: Number, required: true },
  expectedReturn: { type: Number, required: true },
  
  confidence: { type: Number, required: true },
  biasApplied: { type: Number, default: 0 },
  driftState: {
    type: String,
    default: 'NORMAL',
    enum: ['NORMAL', 'WARNING', 'CRITICAL'],
  },
  
  status: {
    type: String,
    required: true,
    default: 'ACTIVE',
    enum: ['ACTIVE', 'SUPERSEDED', 'RESOLVED'],
  },
  
  rollReason: {
    type: String,
    enum: ['MODEL_VERSION_CHANGED', 'BIAS_CROSSED', 'MANUAL', 'SCHEDULED', 'INITIAL'],
  },
  
  outcome: {
    type: String,
    enum: ['WIN', 'LOSS', 'NEUTRAL'],
  },
  actualReturn: { type: Number },
}, {
  collection: 'exch_forecast_segments',
  timestamps: false,
});

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

// Partial unique: only ONE active per asset+horizon
ExchForecastSegmentSchema.index(
  { asset: 1, horizon: 1 },
  { partialFilterExpression: { status: 'ACTIVE' }, name: 'active_unique' }
);

// Primary lookup
ExchForecastSegmentSchema.index({ segmentId: 1 }, { unique: true, name: 'segmentId_unique' });

// Timeline queries
ExchForecastSegmentSchema.index({ asset: 1, horizon: 1, createdAt: -1 }, { name: 'timeline' });
ExchForecastSegmentSchema.index({ asset: 1, horizon: 1, status: 1 }, { name: 'status_lookup' });

// Resolution queries
ExchForecastSegmentSchema.index({ horizon: 1, status: 1, resolvedAt: 1 }, { name: 'resolution' });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export const ExchForecastSegmentModel: Model<ExchForecastSegmentDocument> =
  models.ExchForecastSegment ||
  model<ExchForecastSegmentDocument>('ExchForecastSegment', ExchForecastSegmentSchema);

console.log('[Exchange ML] Forecast Segment Model loaded (BLOCK 5.1)');
