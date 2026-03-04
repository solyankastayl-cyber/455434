/**
 * PHASE 4 — Shadow ML Evaluation
 * ml_shadow_predictions collection
 * 
 * ML predictions on signals/tokens (read-only, no influence)
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface IMLShadowPrediction extends Document {
  subjectId: string; // signalId or tokenId
  snapshotId?: string;
  window: string; // '24h' | '7d' | '30d'
  p_up: number;
  p_down: number;
  p_flat: number;
  calibratedConfidence?: number;
  modelRef: string;
  runId: string;
  features?: Record<string, any>;
  createdAt: Date;
}

const MLShadowPredictionSchema = new Schema<IMLShadowPrediction>(
  {
    subjectId: { type: String, required: true, index: true },
    snapshotId: { type: String, index: true },
    window: { type: String, required: true },
    p_up: { type: Number, required: true },
    p_down: { type: Number, required: true },
    p_flat: { type: Number, required: true },
    calibratedConfidence: { type: Number },
    modelRef: { type: String, required: true },
    runId: { type: String, required: true, index: true },
    features: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: 'ml_shadow_predictions',
  }
);

// Compound indexes
MLShadowPredictionSchema.index({ runId: 1, subjectId: 1 });
MLShadowPredictionSchema.index({ window: 1, createdAt: -1 });

export const MLShadowPredictionModel = mongoose.model<IMLShadowPrediction>(
  'MLShadowPrediction',
  MLShadowPredictionSchema
);
