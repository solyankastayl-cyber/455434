/**
 * PHASE 4 — Shadow ML Evaluation
 * ml_shadow_runs collection
 * 
 * Tracks shadow evaluation runs (no influence on Engine)
 */
import mongoose, { Schema, Document } from 'mongoose';

export type ShadowRunStatus = 'RUNNING' | 'DONE' | 'FAILED';
export type WindowType = '24h' | '7d' | '30d';

export interface IMLShadowRun extends Document {
  runId: string;
  window: WindowType;
  sampleCount: number;
  modelRef: string;
  status: ShadowRunStatus;
  startedAt: Date;
  finishedAt?: Date;
  notes: string[];
  metrics?: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1?: number;
    ece?: number;
    agreementRate?: number;
    flipRate?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const MLShadowRunSchema = new Schema<IMLShadowRun>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    window: { type: String, required: true, enum: ['24h', '7d', '30d'] },
    sampleCount: { type: Number, required: true, default: 0 },
    modelRef: { type: String, required: true },
    status: { type: String, required: true, enum: ['RUNNING', 'DONE', 'FAILED'], default: 'RUNNING' },
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    notes: { type: [String], default: [] },
    metrics: {
      accuracy: Number,
      precision: Number,
      recall: Number,
      f1: Number,
      ece: Number,
      agreementRate: Number,
      flipRate: Number,
    },
  },
  {
    timestamps: true,
    collection: 'ml_shadow_runs',
  }
);

// Indexes
MLShadowRunSchema.index({ window: 1, createdAt: -1 });
MLShadowRunSchema.index({ status: 1 });

export const MLShadowRunModel = mongoose.model<IMLShadowRun>('MLShadowRun', MLShadowRunSchema);
