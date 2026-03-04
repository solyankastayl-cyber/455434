/**
 * Exchange Auto-Learning Loop - PR1: Label Job Types
 * 
 * Types for the labeling job system.
 */

import { ExchangeHorizon, LabelResult } from '../dataset/exchange_dataset.types.js';

// ═══════════════════════════════════════════════════════════════
// LABEL JOB
// ═══════════════════════════════════════════════════════════════

export type LabelJobStatus = 
  | 'PENDING'      // Scheduled for resolution
  | 'PROCESSING'   // Currently being processed
  | 'COMPLETED'    // Successfully resolved
  | 'FAILED';      // Error during resolution

export interface ExchangeLabelJob {
  _id?: string;
  sampleId: string;                // Reference to exch_dataset_samples._id
  symbol: string;
  horizon: ExchangeHorizon;
  
  // Job scheduling
  resolveAt: Date;                 // When to run
  status: LabelJobStatus;
  
  // Processing details
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: Date | null;
  error: string | null;
  
  // Result (filled when completed)
  result?: {
    exitPrice: number;
    returnPct: number;
    label: LabelResult;
  };
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// ═══════════════════════════════════════════════════════════════
// LABEL WORKER CONFIG
// ═══════════════════════════════════════════════════════════════

export interface LabelWorkerConfig {
  // How often to run (ms)
  intervalMs: number;
  
  // Max jobs to process per run
  batchSize: number;
  
  // Max attempts before marking as failed
  maxAttempts: number;
  
  // Grace period after resolveAt before processing (to ensure price is available)
  gracePeriodMs: number;
  
  // WIN/LOSS thresholds
  winThresholdPct: number;         // e.g., 0.01 = 1%
  neutralZonePct: number;          // e.g., 0.005 = 0.5%
  
  // Consider signal direction for labeling
  useDirectionAware: boolean;
}

export const DEFAULT_LABEL_WORKER_CONFIG: LabelWorkerConfig = {
  intervalMs: 5 * 60 * 1000,       // Every 5 minutes
  batchSize: 50,
  maxAttempts: 3,
  gracePeriodMs: 60 * 60 * 1000,   // 1 hour grace period
  winThresholdPct: 0.01,           // 1% = WIN
  neutralZonePct: 0.005,           // +/- 0.5% = NEUTRAL
  useDirectionAware: true,
};

// ═══════════════════════════════════════════════════════════════
// LABEL SCHEDULER CONFIG
// ═══════════════════════════════════════════════════════════════

export interface LabelSchedulerConfig {
  // How often to check for new samples needing jobs
  checkIntervalMs: number;
  
  // Max jobs to create per check
  batchSize: number;
}

export const DEFAULT_LABEL_SCHEDULER_CONFIG: LabelSchedulerConfig = {
  checkIntervalMs: 60 * 1000,      // Every minute
  batchSize: 100,
};

// ═══════════════════════════════════════════════════════════════
// WORKER STATS
// ═══════════════════════════════════════════════════════════════

export interface LabelWorkerStats {
  lastRunAt: Date | null;
  jobsProcessed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  
  // Recent results
  recentWins: number;
  recentLosses: number;
  recentNeutral: number;
  
  // Performance
  avgProcessingTimeMs: number;
  errorRate: number;
}

console.log('[Exchange ML] Label job types loaded');
