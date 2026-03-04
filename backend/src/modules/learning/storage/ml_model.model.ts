/**
 * PHASE 5.2 — ML Model Registry
 * ==============================
 * MongoDB model for ML models with staging
 */

import mongoose, { Schema, Document } from 'mongoose';

export type MlModelStage = 'ACTIVE' | 'CANDIDATE' | 'RETIRED';
export type MlModelAlgo = 'logreg' | 'tree';

export interface MlModelDoc extends Document {
  modelId: string;
  stage: MlModelStage;
  algo: MlModelAlgo;
  createdAt: Date;
  promotedAt?: Date;

  dataset: {
    fromTs: number;
    toTs: number;
    rows: number;
    split: { train: number; val: number; test: number };
  };

  metrics: {
    accuracy: number;
    brier: number;
    ece: number;
    auc?: number;
  };

  artifact: {
    weights?: number[];
    bias?: number;
    tree?: any;
    scaler?: { mean: number[]; std: number[] };
    featureSchemaHash: string;
  };

  // Shadow monitoring state
  shadow?: {
    critStreak: number;
    degStreak: number;
    lastEvalAt?: Date;
    lastHealth?: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
  };

  notes?: string;
}

const MlModelSchema = new Schema<MlModelDoc>(
  {
    modelId: { type: String, required: true, unique: true, index: true },
    stage: { type: String, required: true, index: true, enum: ['ACTIVE', 'CANDIDATE', 'RETIRED'] },
    algo: { type: String, required: true, enum: ['logreg', 'tree'] },

    promotedAt: { type: Date },

    dataset: {
      fromTs: { type: Number, required: true },
      toTs: { type: Number, required: true },
      rows: { type: Number, required: true },
      split: {
        train: { type: Number, required: true },
        val: { type: Number, required: true },
        test: { type: Number, required: true },
      },
    },

    metrics: {
      accuracy: { type: Number, required: true },
      brier: { type: Number, required: true },
      ece: { type: Number, required: true },
      auc: { type: Number },
    },

    artifact: {
      weights: { type: [Number] },
      bias: { type: Number },
      tree: { type: Schema.Types.Mixed },
      scaler: {
        mean: { type: [Number] },
        std: { type: [Number] },
      },
      featureSchemaHash: { type: String, required: true },
    },

    shadow: {
      critStreak: { type: Number, default: 0 },
      degStreak: { type: Number, default: 0 },
      lastEvalAt: { type: Date },
      lastHealth: { type: String, enum: ['HEALTHY', 'DEGRADED', 'CRITICAL'] },
    },

    notes: { type: String },
  },
  { 
    collection: 'ml_model_registry',
    timestamps: true 
  }
);

MlModelSchema.index({ stage: 1, createdAt: -1 });
MlModelSchema.index({ algo: 1, stage: 1 });

export const MlModelRegistry = mongoose.models.MlModelRegistry ||
  mongoose.model<MlModelDoc>('MlModelRegistry', MlModelSchema);

console.log('[Phase 5.2] ML Model Registry loaded');
