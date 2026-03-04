/**
 * PHASE 1.4 — Backfill Model
 * ===========================
 * 
 * MongoDB model for tracking backfill job runs.
 */

import mongoose from 'mongoose';

const BackfillRunSchema = new mongoose.Schema({
  runId: { type: String, required: true, unique: true, index: true },
  symbol: { type: String, required: true, index: true },
  tf: { type: String, required: true },
  days: { type: Number, required: true },
  from: { type: Number, required: true },
  to: { type: Number, required: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'],
    index: true,
  },
  progress: {
    barsSaved: { type: Number, default: 0 },
    truthRecordsSaved: { type: Number, default: 0 },
    lastTs: { type: Number, default: null },
  },
  error: { type: String, default: null },
  startedAt: { type: Number, required: true },
  completedAt: { type: Number, default: null },
}, {
  timestamps: true,
  collection: 'market_backfill_runs',
});

export const BackfillRunModel = mongoose.model('BackfillRun', BackfillRunSchema);

console.log('[Phase 1.4] BackfillRun Model loaded');
