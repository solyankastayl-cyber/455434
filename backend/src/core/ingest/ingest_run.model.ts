/**
 * ETAP 6.1 — Ingest Run Model
 * 
 * Audit log for each ingest job execution.
 * Used for debugging and monitoring.
 */
import mongoose from 'mongoose';

export interface IIngestRun {
  jobId: string;
  chain: string;
  window: string;
  mode: 'incremental' | 'backfill';
  
  startedAt: Date;
  finishedAt: Date | null;
  
  fromBlock: number;
  toBlock: number;
  
  inserted: number;
  skippedDuplicates: number;
  errors: number;
  errorSamples: string[];
  
  status: 'running' | 'completed' | 'failed';
}

const IngestRunSchema = new mongoose.Schema<IIngestRun>({
  jobId: {
    type: String,
    required: true,
    unique: true,
  },
  chain: {
    type: String,
    required: true,
  },
  window: {
    type: String,
    required: true,
  },
  mode: {
    type: String,
    enum: ['incremental', 'backfill'],
    default: 'incremental',
  },
  startedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  finishedAt: {
    type: Date,
    default: null,
  },
  fromBlock: {
    type: Number,
    default: 0,
  },
  toBlock: {
    type: Number,
    default: 0,
  },
  inserted: {
    type: Number,
    default: 0,
  },
  skippedDuplicates: {
    type: Number,
    default: 0,
  },
  errors: {
    type: Number,
    default: 0,
  },
  errorSamples: {
    type: [String],
    default: [],
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    default: 'running',
  },
}, {
  collection: 'ingest_runs',
  timestamps: false,
});

// Query indexes
IngestRunSchema.index({ chain: 1, window: 1, startedAt: -1 });
IngestRunSchema.index({ status: 1, startedAt: -1 });

export const IngestRunModel = mongoose.model<IIngestRun>(
  'IngestRun',
  IngestRunSchema
);
