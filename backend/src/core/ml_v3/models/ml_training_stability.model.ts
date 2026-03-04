/**
 * ML Training Stability Model - P1.1
 * 
 * Stores multi-seed training stability analysis results
 */
import mongoose, { Schema, model, Document } from 'mongoose';

export interface IMlTrainingStability extends Document {
  task: string;
  network: string;
  featurePack: string;
  datasetId: string;

  runsRequested: number;
  runsCompleted: number;

  metrics: any[];
  stats: {
    mean: { accuracy: number; f1: number };
    std: { accuracy: number; f1: number };
    cv: { accuracy: number; f1: number };
  };

  verdict: string;
  reasons: string[];

  createdAt: Date;
}

const StabilityMetricsSchema = new Schema({
  seed: { type: Number, required: true },
  modelId: { type: String, required: true },
  accuracy: { type: Number, required: true },
  f1: { type: Number, required: true },
  precision: { type: Number, required: true },
  recall: { type: Number, required: true },
  trainMs: { type: Number },
}, { _id: false });

const StabilityStatsSchema = new Schema({
  mean: {
    accuracy: { type: Number, required: true },
    f1: { type: Number, required: true },
  },
  std: {
    accuracy: { type: Number, required: true },
    f1: { type: Number, required: true },
  },
  cv: {
    accuracy: { type: Number, required: true },
    f1: { type: Number, required: true },
  },
}, { _id: false });

const MlTrainingStabilitySchema = new Schema<IMlTrainingStability>({
  task: { type: String, required: true, index: true },
  network: { type: String, required: true, index: true },
  featurePack: { type: String, required: true, index: true },
  datasetId: { type: String, required: true, index: true },

  runsRequested: { type: Number, required: true },
  runsCompleted: { type: Number, required: true },

  metrics: { type: [StabilityMetricsSchema], default: [] },
  stats: { type: StabilityStatsSchema, required: true },

  verdict: {
    type: String,
    enum: ['STABLE', 'UNSTABLE', 'INCONCLUSIVE'],
    required: true,
  },
  reasons: { type: [String], default: [] },

  createdAt: { type: Date, default: Date.now, index: true },
});

// Composite indexes
MlTrainingStabilitySchema.index({ task: 1, network: 1, featurePack: 1, createdAt: -1 });
MlTrainingStabilitySchema.index({ verdict: 1, createdAt: -1 });

export const MlTrainingStabilityModel =
  (mongoose.models.ml_training_stability as mongoose.Model<IMlTrainingStability>) ||
  model<IMlTrainingStability>('ml_training_stability', MlTrainingStabilitySchema);
