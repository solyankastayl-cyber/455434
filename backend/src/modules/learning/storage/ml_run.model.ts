/**
 * PHASE 5.2 — ML Run Tracking
 * ============================
 * MongoDB model for ML operation runs
 */

import mongoose, { Schema, Document } from 'mongoose';

export type MlRunType = 'RETRAIN' | 'PROMOTION' | 'SHADOW_EVAL' | 'ROLLBACK';
export type MlRunStatus = 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export interface MlRunDoc extends Document {
  runId: string;
  type: MlRunType;
  status: MlRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  meta?: any;
  error?: string;
}

const MlRunSchema = new Schema<MlRunDoc>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    type: { type: String, required: true, index: true, enum: ['RETRAIN', 'PROMOTION', 'SHADOW_EVAL', 'ROLLBACK'] },
    status: { type: String, required: true, index: true, enum: ['RUNNING', 'DONE', 'FAILED', 'CANCELLED'] },
    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date },
    meta: { type: Schema.Types.Mixed },
    error: { type: String },
  },
  { 
    collection: 'ml_runs',
    timestamps: true 
  }
);

MlRunSchema.index({ type: 1, createdAt: -1 });
MlRunSchema.index({ status: 1, type: 1 });

export const MlRun = mongoose.models.MlRun ||
  mongoose.model<MlRunDoc>('MlRun', MlRunSchema);

console.log('[Phase 5.2] ML Run Tracking loaded');
