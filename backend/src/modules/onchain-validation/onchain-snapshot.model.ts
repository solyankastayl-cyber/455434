/**
 * S7.1 — OnchainSnapshot Model
 * ============================
 * 
 * Snapshot of on-chain reality at signal time (t0).
 * Used by Validation Layer to confirm/contradict ObservationModel decisions.
 * 
 * CRITICAL RULES:
 * - Snapshot = FACT, not interpretation
 * - Timestamp MUST be <= t0 (no lookahead!)
 * - Data is READ-ONLY from existing onchain sources
 * - confidence < 0.4 = NO_DATA verdict
 */

import mongoose, { Schema, Document, Types } from 'mongoose';

// ============================================================
// Types
// ============================================================

export type OnchainSource = 'exchange_pressure' | 'transfers' | 'mock';

export interface IOnchainSnapshot extends Document {
  _id: Types.ObjectId;
  
  // Reference
  signal_id: string;
  observation_id?: string;
  
  // Asset & Timing
  asset: 'BTC' | 'ETH' | 'SOL';
  network: string;
  t0_timestamp: Date;
  snapshot_timestamp: Date;  // When data was captured (must be <= t0)
  
  // Exchange Flow Metrics
  exchange_inflow: number;      // Deposits to CEX (in tx count or volume)
  exchange_outflow: number;     // Withdrawals from CEX
  net_flow: number;             // inflow - outflow (positive = sell pressure)
  
  // Whale Activity
  whale_tx_count: number;       // Large transactions (>$100k)
  whale_volume: number;         // Total whale volume
  whale_activity_flag: boolean; // Significant whale movement detected
  
  // Derived Signals
  exchange_pressure: number;    // -1 to +1 (negative = buy pressure)
  exchange_signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  
  // Data Quality
  source: OnchainSource;
  confidence: number;           // 0-1, based on data completeness
  data_points_used: number;     // How many data sources contributed
  
  // Raw signals for explainability
  raw_signals: Array<{
    type: string;
    value: number | string | boolean;
    source: string;
  }>;
  
  // Metadata
  created_at: Date;
  window: string;  // '1h', '4h', '24h'
}

// ============================================================
// Schema
// ============================================================

const OnchainSnapshotSchema = new Schema<IOnchainSnapshot>({
  signal_id: { type: String, required: true, index: true },
  observation_id: { type: String, index: true },
  
  asset: { type: String, required: true, enum: ['BTC', 'ETH', 'SOL'] },
  network: { type: String, required: true, default: 'ethereum' },
  t0_timestamp: { type: Date, required: true, index: true },
  snapshot_timestamp: { type: Date, required: true },
  
  exchange_inflow: { type: Number, default: 0 },
  exchange_outflow: { type: Number, default: 0 },
  net_flow: { type: Number, default: 0 },
  
  whale_tx_count: { type: Number, default: 0 },
  whale_volume: { type: Number, default: 0 },
  whale_activity_flag: { type: Boolean, default: false },
  
  exchange_pressure: { type: Number, default: 0 },
  exchange_signal: { 
    type: String, 
    enum: ['STRONG_BUY', 'BUY', 'NEUTRAL', 'SELL', 'STRONG_SELL'],
    default: 'NEUTRAL'
  },
  
  source: { type: String, enum: ['exchange_pressure', 'transfers', 'mock'], default: 'mock' },
  confidence: { type: Number, default: 0 },
  data_points_used: { type: Number, default: 0 },
  
  raw_signals: [{
    type: { type: String },
    value: Schema.Types.Mixed,
    source: { type: String },
  }],
  
  window: { type: String, default: '1h' },
}, {
  timestamps: { createdAt: 'created_at', updatedAt: false },
  collection: 'onchain_snapshots',
});

// Indexes
OnchainSnapshotSchema.index({ signal_id: 1, window: 1 }, { unique: true });
OnchainSnapshotSchema.index({ asset: 1, t0_timestamp: -1 });
OnchainSnapshotSchema.index({ confidence: 1 });

export const OnchainSnapshotModel = mongoose.models.OnchainSnapshot ||
  mongoose.model<IOnchainSnapshot>('OnchainSnapshot', OnchainSnapshotSchema);
