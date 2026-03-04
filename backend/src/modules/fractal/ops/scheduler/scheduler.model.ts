/**
 * BLOCK 80.1 — Ops Scheduler Models
 * 
 * MongoDB models for daily-run state and job history.
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// SCHEDULER STATE (single source of truth)
// ═══════════════════════════════════════════════════════════════

const SchedulerStateSchema = new mongoose.Schema(
  {
    jobId: { type: String, unique: true, required: true, index: true },
    enabled: { type: Boolean, default: false },
    scheduleUtc: { type: String, default: '00:10' },
    timezone: { type: String, default: 'UTC' },
    
    nextRunAt: { type: Date },
    lastRunAt: { type: Date },
    lastStatus: { 
      type: String, 
      enum: ['SUCCESS', 'FAILED', 'SKIPPED', 'RUNNING', 'NEVER'],
      default: 'NEVER'
    },
    lastDurationMs: { type: Number, default: 0 },
    
    lastSummary: {
      steps: [{ 
        name: String, 
        status: String, 
        durationMs: Number,
        count: Number,
        error: String
      }],
      alertsSent: { type: Number, default: 0 },
      snapshotsWritten: { type: Number, default: 0 },
      outcomesResolved: { type: Number, default: 0 },
    },
    
    // Distributed lock
    lock: {
      lockedUntil: { type: Date },
      owner: { type: String },
      runId: { type: String },
    },
    
    lastError: {
      code: String,
      message: String,
      timestamp: Date,
    },
  },
  { 
    timestamps: true,
    collection: 'ops_scheduler_state'
  }
);

export const SchedulerStateModel = mongoose.model('SchedulerState', SchedulerStateSchema);

// ═══════════════════════════════════════════════════════════════
// JOB RUNS HISTORY (audit trail)
// ═══════════════════════════════════════════════════════════════

const JobRunSchema = new mongoose.Schema(
  {
    runId: { type: String, unique: true, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    trigger: { type: String, enum: ['CRON', 'MANUAL'], required: true },
    
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    status: { 
      type: String, 
      enum: ['RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED'],
      default: 'RUNNING'
    },
    durationMs: { type: Number, default: 0 },
    
    steps: [{
      name: { type: String },
      status: { type: String },
      startedAt: { type: Date },
      finishedAt: { type: Date },
      durationMs: { type: Number },
      count: { type: Number },
      details: { type: Object },
      error: { type: String },
    }],
    
    summary: {
      snapshotsWritten: { type: Number, default: 0 },
      outcomesResolved: { type: Number, default: 0 },
      alertsSent: { type: Number, default: 0 },
      driftSeverity: { type: String },
    },
    
    error: {
      code: String,
      message: String,
      stack: String,
    },
  },
  { 
    timestamps: true,
    collection: 'ops_job_runs'
  }
);

JobRunSchema.index({ startedAt: -1 });
JobRunSchema.index({ jobId: 1, startedAt: -1 });

export const JobRunModel = mongoose.model('JobRun', JobRunSchema);

export default { SchedulerStateModel, JobRunModel };
