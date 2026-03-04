/**
 * ML Retrain Queue Model
 * 
 * BATCH 1: Единственная точка входа для retrain.
 * ML v2.3: Extended with mlVersion and v23Config.
 * Гарантия: никакого параллельного обучения.
 */

import { Schema, model, Document } from 'mongoose';
import type { IV23Config, MlVersionType } from './auto_retrain/ml_retrain_policy.model.js';

export type RetrainStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type RetrainReason = 'DRIFT' | 'SCHEDULE' | 'MANUAL' | 'AUTO_POLICY';

// B4.2: ML Version types
export type MlVersionType = 'v2.1' | 'v2.3' | 'v3.0';

export interface IMlRetrainQueue extends Document {
  network: string;
  modelType: 'market' | 'actor';
  reason: RetrainReason;
  status: RetrainStatus;
  createdAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
  error?: string;
  // ML v2.3: Which version to use for training
  mlVersion?: MlVersionType;
  v23Config?: IV23Config;
  // B4.2: Feature pack for v3.0 training
  featurePack?: string; // 'PACK_A' | 'PACK_A_PLUS_DEX'
  datasetId?: string;
}

const MlRetrainQueueSchema = new Schema<IMlRetrainQueue>({
  network: { type: String, required: true },
  modelType: { 
    type: String, 
    enum: ['market', 'actor'], 
    required: true 
  },
  reason: {
    type: String,
    enum: ['DRIFT', 'SCHEDULE', 'MANUAL', 'AUTO_POLICY'],
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'RUNNING', 'DONE', 'FAILED'],
    default: 'PENDING'
  },
  createdAt: { type: Date, default: Date.now },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  error: { type: String },
  // ML v2.3
  mlVersion: { type: String, enum: ['v2.1', 'v2.3', 'v3.0'] },
  v23Config: { type: Schema.Types.Mixed },
  // B4.2: v3.0 training routing
  featurePack: { type: String, enum: ['PACK_A', 'PACK_A_PLUS_DEX'] },
  datasetId: { type: String },
});

// Index for efficient queue processing
MlRetrainQueueSchema.index({ status: 1, createdAt: 1 });
MlRetrainQueueSchema.index({ modelType: 1, network: 1, status: 1 });
MlRetrainQueueSchema.index({ mlVersion: 1, status: 1 }); // ML v2.3

export const MlRetrainQueueModel = model<IMlRetrainQueue>(
  'ml_retrain_queue',
  MlRetrainQueueSchema
);
