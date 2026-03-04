/**
 * SPX TERMINAL — MongoDB Models
 * 
 * BLOCK B1/B3 — SPX Data Foundation + Index Hardening
 * 
 * Collections:
 * - spx_candles: Daily OHLCV data
 * - spx_backfill_progress: Backfill job state
 * - spx_ingestion_log: Ingestion audit trail
 */

import mongoose, { Schema, Model } from 'mongoose';
import type { SpxCandle, SpxBackfillProgress } from './spx.types.js';

// ═══════════════════════════════════════════════════════════════
// SPX CANDLES
// ═══════════════════════════════════════════════════════════════

const SpxCandleSchema = new Schema<SpxCandle>(
  {
    ts: { type: Number, required: true },
    date: { type: String, required: true },
    open: { type: Number, required: true },
    high: { type: Number, required: true },
    low: { type: Number, required: true },
    close: { type: Number, required: true },
    volume: { type: Number, default: null },
    
    // B6.4 — Sequential index for deterministic calibration
    idx: { type: Number, default: null },
    // Alias for close (for calibration compatibility)
    c: { type: Number },

    symbol: { type: String, enum: ['SPX'], required: true, default: 'SPX' },
    source: { type: String, enum: ['STOOQ', 'MANUAL'], required: true, default: 'STOOQ' },
    cohort: { type: String, enum: ['V1950', 'V1990', 'V2008', 'V2020', 'LIVE'], required: true },
  },
  { 
    timestamps: true, 
    collection: 'spx_candles',
  }
);

// Index pack (BLOCK B3)
SpxCandleSchema.index({ ts: 1 }, { unique: true, name: 'uniq_ts' });
SpxCandleSchema.index({ ts: -1 }, { name: 'ts_desc' });
SpxCandleSchema.index({ cohort: 1, ts: 1 }, { name: 'cohort_ts' });
SpxCandleSchema.index({ date: 1 }, { name: 'date_idx' });

export const SpxCandleModel: Model<SpxCandle> =
  mongoose.models.SpxCandle || mongoose.model<SpxCandle>('SpxCandle', SpxCandleSchema);

// ═══════════════════════════════════════════════════════════════
// SPX BACKFILL PROGRESS
// ═══════════════════════════════════════════════════════════════

const SpxBackfillProgressSchema = new Schema<SpxBackfillProgress>(
  {
    jobId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['idle', 'running', 'completed', 'failed'], default: 'idle' },
    lastProcessedTs: { type: Number, default: 0 },
    totalInserted: { type: Number, default: 0 },
    totalUpdated: { type: Number, default: 0 },
    errors: { type: Number, default: 0 },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { 
    timestamps: true,
    collection: 'spx_backfill_progress',
  }
);

export const SpxBackfillProgressModel: Model<SpxBackfillProgress> =
  mongoose.models.SpxBackfillProgress || 
  mongoose.model<SpxBackfillProgress>('SpxBackfillProgress', SpxBackfillProgressSchema);

// ═══════════════════════════════════════════════════════════════
// SPX INGESTION LOG
// ═══════════════════════════════════════════════════════════════

interface SpxIngestionLog {
  runId: string;
  source: string;
  status: 'success' | 'partial' | 'failed';
  fetchedRows: number;
  insertedRows: number;
  skippedRows: number;
  errors: string[];
  rangeFrom?: string;
  rangeTo?: string;
  durationMs: number;
  createdAt?: Date;
}

const SpxIngestionLogSchema = new Schema<SpxIngestionLog>(
  {
    runId: { type: String, required: true },
    source: { type: String, required: true },
    status: { type: String, enum: ['success', 'partial', 'failed'], required: true },
    fetchedRows: { type: Number, default: 0 },
    insertedRows: { type: Number, default: 0 },
    skippedRows: { type: Number, default: 0 },
    errors: [{ type: String }],
    rangeFrom: { type: String },
    rangeTo: { type: String },
    durationMs: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    collection: 'spx_ingestion_log',
  }
);

SpxIngestionLogSchema.index({ createdAt: -1 });
SpxIngestionLogSchema.index({ runId: 1 });

export const SpxIngestionLogModel: Model<SpxIngestionLog> =
  mongoose.models.SpxIngestionLog ||
  mongoose.model<SpxIngestionLog>('SpxIngestionLog', SpxIngestionLogSchema);

// ═══════════════════════════════════════════════════════════════
// INDEX UTILITY
// ═══════════════════════════════════════════════════════════════

export async function ensureSpxIndexes(): Promise<{ ok: boolean; indexes: string[] }> {
  const indexes: string[] = [];
  
  // SpxCandle indexes
  await SpxCandleModel.collection.createIndex({ ts: 1 }, { unique: true, name: 'uniq_ts' });
  indexes.push('spx_candles:uniq_ts');
  
  await SpxCandleModel.collection.createIndex({ ts: -1 }, { name: 'ts_desc' });
  indexes.push('spx_candles:ts_desc');
  
  await SpxCandleModel.collection.createIndex({ cohort: 1, ts: 1 }, { name: 'cohort_ts' });
  indexes.push('spx_candles:cohort_ts');
  
  await SpxCandleModel.collection.createIndex({ date: 1 }, { name: 'date_idx' });
  indexes.push('spx_candles:date_idx');

  return { ok: true, indexes };
}
