/**
 * PHASE 3 — ML Dataset Model
 * ===========================
 * MongoDB storage for training data
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IMlDatasetRow extends Document {
  symbol: string;
  t0: number;
  t1: number;
  horizonBars: number;
  features: Record<string, number>;
  y: number;
  rawConfidence?: number;
  predictedDirection?: string;
  sourceMeta?: Record<string, any>;
}

const MlDatasetRowSchema = new Schema<IMlDatasetRow>(
  {
    symbol: { type: String, required: true, index: true },
    t0: { type: Number, required: true, index: true },
    t1: { type: Number, required: true },
    horizonBars: { type: Number, required: true, index: true },
    features: { type: Schema.Types.Mixed, required: true },
    y: { type: Number, required: true },
    rawConfidence: { type: Number },
    predictedDirection: { type: String },
    sourceMeta: { type: Schema.Types.Mixed },
  },
  {
    collection: 'ml_dataset_v1',
    timestamps: true,
  }
);

MlDatasetRowSchema.index({ symbol: 1, t0: 1, horizonBars: 1 }, { unique: true });

export const MlDatasetRowModel = mongoose.models.MlDatasetRow ||
  mongoose.model<IMlDatasetRow>('MlDatasetRow', MlDatasetRowSchema);

// Trained models storage
export interface IMlModel extends Document {
  modelType: string;
  version: string;
  trainedAt: Date;
  metrics: Record<string, number>;
  featureNames: string[];
  weights?: number[];
  bias?: number;
  tree?: any;
  scaler?: { mean: number[]; std: number[] };
  isActive: boolean;
}

const MlModelSchema = new Schema<IMlModel>(
  {
    modelType: { type: String, required: true, index: true },
    version: { type: String, required: true },
    trainedAt: { type: Date, required: true, index: true },
    metrics: { type: Schema.Types.Mixed, required: true },
    featureNames: { type: [String], required: true },
    weights: { type: [Number] },
    bias: { type: Number },
    tree: { type: Schema.Types.Mixed },
    scaler: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: false, index: true },
  },
  {
    collection: 'ml_models',
    timestamps: true,
  }
);

MlModelSchema.index({ modelType: 1, trainedAt: -1 });

export const MlModelModel = mongoose.models.MlModel ||
  mongoose.model<IMlModel>('MlModel', MlModelSchema);

console.log('[Phase 3] ML Storage Models loaded');
