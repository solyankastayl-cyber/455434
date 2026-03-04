/**
 * PHASE 4 — Shadow ML Evaluation
 * ml_shadow_evaluations collection
 * 
 * Quality assessment of ML predictions vs ground truth
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface ICoverageStrata {
  band: 'low' | 'medium' | 'high';
  accuracy: number;
  sampleCount: number;
  precision: number;
  recall: number;
  f1: number;
  ece: number;
  agreementRate: number;
}

export interface IECEBin {
  bin: string;
  count: number;
  accuracy: number;
  confidence: number;
}

export interface ICalibrationPoint {
  confidence: number;
  accuracy: number;
  count: number;
}

export interface IMLShadowEvaluation extends Document {
  runId: string;
  window: string;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  ece: number; // Expected Calibration Error
  eceBins: IECEBin[]; // NEW: ECE bins for analysis
  agreementRate: number; // NEW: ML-Engine agreement
  flipRate: number; // NEW: ML-Engine flip rate
  calibrationCurve: ICalibrationPoint[]; // NEW: Calibration curve
  confusionMatrix: {
    tp: number;
    tn: number;
    fp: number;
    fn: number;
  };
  coverageStrata: ICoverageStrata[];
  driftDelta?: number;
  failures: string[];
  sampleCount: number;
  createdAt: Date;
}

const MLShadowEvaluationSchema = new Schema<IMLShadowEvaluation>(
  {
    runId: { type: String, required: true, unique: true, index: true },
    window: { type: String, required: true },
    accuracy: { type: Number, required: true },
    precision: { type: Number, required: true },
    recall: { type: Number, required: true },
    f1: { type: Number, required: true },
    ece: { type: Number, required: true },
    eceBins: [
      {
        bin: String,
        count: Number,
        accuracy: Number,
        confidence: Number,
      },
    ],
    agreementRate: { type: Number, default: 0 },
    flipRate: { type: Number, default: 0 },
    calibrationCurve: [
      {
        confidence: Number,
        accuracy: Number,
        count: Number,
      },
    ],
    confusionMatrix: {
      tp: { type: Number, required: true },
      tn: { type: Number, required: true },
      fp: { type: Number, required: true },
      fn: { type: Number, required: true },
    },
    coverageStrata: [
      {
        band: { type: String, enum: ['low', 'medium', 'high'] },
        accuracy: Number,
        sampleCount: Number,
        precision: Number,
        recall: Number,
        f1: Number,
        ece: Number,
        agreementRate: Number,
      },
    ],
    driftDelta: { type: Number },
    failures: { type: [String], default: [] },
    sampleCount: { type: Number, required: true },
  },
  {
    timestamps: true,
    collection: 'ml_shadow_evaluations',
  }
);

MLShadowEvaluationSchema.index({ window: 1, createdAt: -1 });

export const MLShadowEvaluationModel = mongoose.model<IMLShadowEvaluation>(
  'MLShadowEvaluation',
  MLShadowEvaluationSchema
);
