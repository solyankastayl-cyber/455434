/**
 * Forecast Segment Model (BLOCK 4)
 * 
 * Stores prediction segments for visualization.
 * - ACTIVE: Current prediction segment
 * - GHOST: Previous segments (shown as faded on graph)
 * 
 * Key concept: 30D predictions rollover every 7D checkpoint,
 * creating a trail of historical predictions.
 */

import { Schema, model, models, Document, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SegmentLayer = 'forecast' | 'exchange' | 'onchain' | 'sentiment';
export type SegmentHorizon = '1D' | '7D' | '30D';
export type SegmentStatus = 'ACTIVE' | 'GHOST';
export type RolloverReason = 'ROLLOVER_7D' | 'MANUAL' | 'RETRAIN' | 'AUTO_PROMOTION' | 'INITIAL';

export interface SegmentCandle {
  time: number;     // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ForecastSegment {
  _id?: string;
  
  // Identification
  segmentId: string;
  symbol: string;
  layer: SegmentLayer;
  horizon: SegmentHorizon;
  
  // Time range
  startTs: number;      // Unix seconds (anchor point)
  endTs: number;        // Unix seconds (target time)
  createdAtTs: number;  // Unix seconds
  
  // Status
  status: SegmentStatus;
  reason?: RolloverReason;
  
  // Price data
  fromPrice: number;
  targetPrice: number;
  expectedMovePct: number;
  
  // Synthetic candles for this segment
  candles: SegmentCandle[];
  
  // Metadata
  meta?: {
    modelVersion?: string;
    confidence?: number;
    qualityState?: string;
    driftState?: string;
    positionPct?: number;
    source?: string;
    snapshotId?: string;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface ForecastSegmentDocument extends ForecastSegment, Document {}

// ═══════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════

const CandleSchema = new Schema({
  time: { type: Number, required: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, required: false },
}, { _id: false });

const ForecastSegmentSchema = new Schema<ForecastSegmentDocument>({
  segmentId: {
    type: String,
    required: true,
    unique: true,
  },
  
  symbol: { type: String, required: true },
  layer: {
    type: String,
    required: true,
    enum: ['forecast', 'exchange', 'onchain', 'sentiment'],
  },
  horizon: {
    type: String,
    required: true,
    enum: ['1D', '7D', '30D'],
  },
  
  startTs: { type: Number, required: true },
  endTs: { type: Number, required: true },
  createdAtTs: { type: Number, required: true },
  
  status: {
    type: String,
    required: true,
    enum: ['ACTIVE', 'GHOST'],
  },
  reason: {
    type: String,
    enum: ['ROLLOVER_7D', 'MANUAL', 'RETRAIN', 'AUTO_PROMOTION', 'INITIAL'],
  },
  
  fromPrice: { type: Number, required: true },
  targetPrice: { type: Number, required: true },
  expectedMovePct: { type: Number, required: true },
  
  candles: { type: [CandleSchema], required: true },
  
  meta: { type: Schema.Types.Mixed, default: null },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, {
  timestamps: true,
  collection: 'forecast_segments',
});

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

// Primary lookup for active segment
ForecastSegmentSchema.index(
  { symbol: 1, layer: 1, horizon: 1, status: 1, startTs: -1 },
  { name: 'active_segment_lookup' }
);

// Segment ID lookup
ForecastSegmentSchema.index({ segmentId: 1 }, { unique: true, name: 'segmentId_unique' });

// Timeline queries
ForecastSegmentSchema.index({ symbol: 1, layer: 1, horizon: 1, startTs: -1 }, { name: 'segment_timeline' });

// ═══════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════

export const ForecastSegmentModel: Model<ForecastSegmentDocument> =
  models.ForecastSegment ||
  model<ForecastSegmentDocument>('ForecastSegment', ForecastSegmentSchema);

console.log('[Forecast] Segment model loaded (BLOCK 4)');
