/**
 * Neural Model Registry
 * 
 * Stores trained ML models and their metadata
 */
import mongoose, { Schema, Document } from 'mongoose';

export interface INeuralModel extends Document {
  modelType: 'calibration' | 'outcome' | 'ranking';
  version: string;
  trainedAt: Date;
  
  datasetRange: {
    from: Date;
    to: Date;
    sampleCount: number;
  };
  
  metrics: {
    accuracy?: number;
    macroF1?: number;
    brierScore?: number;
    calibrationError?: number;
  };
  
  // Model weights (simplified - in production would be file path or blob)
  weights: {
    features: string[];
    coefficients: number[];
    intercept: number;
    thresholds?: Record<string, number>;
  };
  
  active: boolean;
  
  meta: {
    framework: string;
    notes?: string;
  };
}

const NeuralModelSchema = new Schema<INeuralModel>({
  modelType: { 
    type: String, 
    enum: ['calibration', 'outcome', 'ranking'], 
    required: true 
  },
  version: { type: String, required: true },
  trainedAt: { type: Date, default: Date.now },
  
  datasetRange: {
    from: { type: Date },
    to: { type: Date },
    sampleCount: { type: Number },
  },
  
  metrics: {
    accuracy: { type: Number },
    macroF1: { type: Number },
    brierScore: { type: Number },
    calibrationError: { type: Number },
  },
  
  weights: {
    features: [{ type: String }],
    coefficients: [{ type: Number }],
    intercept: { type: Number },
    thresholds: { type: Map, of: Number },
  },
  
  active: { type: Boolean, default: false },
  
  meta: {
    framework: { type: String, default: 'simple-linear' },
    notes: { type: String },
  },
}, { timestamps: true });

// Indexes
NeuralModelSchema.index({ modelType: 1, active: 1 });
NeuralModelSchema.index({ modelType: 1, version: 1 }, { unique: true });

export const NeuralModelModel = mongoose.models.NeuralModel || mongoose.model<INeuralModel>(
  'NeuralModel',
  NeuralModelSchema,
  'neural_models'
);
