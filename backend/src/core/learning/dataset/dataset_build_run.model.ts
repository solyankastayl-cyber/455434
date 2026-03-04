/**
 * Dataset Build Run Model
 * 
 * ETAP 3.4: Journal of dataset build runs.
 * Tracks what was built, when, and any issues.
 */
import mongoose from 'mongoose';
import type { DatasetBuildConfig, BuildRunResult } from '../types/dataset.types.js';

// ==================== INTERFACE ====================

export interface IDatasetBuildRun {
  runId: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'completed' | 'failed';
  config: DatasetBuildConfig;
  stats: {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
    skipReasons: Record<string, number>;
  };
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==================== SCHEMA ====================

const DatasetBuildConfigSchema = new mongoose.Schema({
  horizons: [{ type: String, enum: ['1d', '7d', '30d'] }],
  since: { type: Date },
  until: { type: Date },
  mode: { type: String, enum: ['incremental', 'backfill'], required: true },
  limit: { type: Number },
  includeNoLive: { type: Boolean, required: true },
  includeCriticalDrift: { type: Boolean, required: true },
}, { _id: false });

const BuildStatsSchema = new mongoose.Schema({
  processed: { type: Number, required: true, default: 0 },
  created: { type: Number, required: true, default: 0 },
  updated: { type: Number, required: true, default: 0 },
  skipped: { type: Number, required: true, default: 0 },
  errors: { type: Number, required: true, default: 0 },
  skipReasons: { type: Map, of: Number, default: {} },
}, { _id: false });

const DatasetBuildRunSchema = new mongoose.Schema<IDatasetBuildRun>({
  runId: {
    type: String,
    required: true,
    unique: true,
  },
  startedAt: {
    type: Date,
    required: true,
  },
  finishedAt: {
    type: Date,
    default: null,
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    required: true,
  },
  config: {
    type: DatasetBuildConfigSchema,
    required: true,
  },
  stats: {
    type: BuildStatsSchema,
    required: true,
  },
  error: {
    type: String,
  },
}, {
  collection: 'dataset_build_runs',
  timestamps: true,
});

// Indexes
DatasetBuildRunSchema.index({ runId: 1 }, { unique: true });
DatasetBuildRunSchema.index({ startedAt: -1 });
DatasetBuildRunSchema.index({ status: 1 });

export const DatasetBuildRunModel = mongoose.model<IDatasetBuildRun>(
  'DatasetBuildRun',
  DatasetBuildRunSchema
);
