/**
 * Confidence Calibration Model (Phase 12A.3)
 * 
 * Tracks historical confidence vs actual outcomes to calibrate predictions.
 * If system predicts 80% confidence but only 60% are correct, calibration = 0.75
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Calibration subject type
 */
export type CalibrationSubject = 'decision' | 'strategy' | 'signal';

/**
 * Confidence Calibration Document Interface
 */
export interface IConfidenceCalibration extends Document {
  _id: Types.ObjectId;
  
  // Subject
  subjectType: CalibrationSubject;
  subjectId: string;  // decision_type | strategy_type | signal_type | address
  
  // Calibration metrics
  calibrationFactor: number;  // Multiplier for raw confidence (0.5 - 1.5)
  
  // Buckets for calibration curve (confidence ranges)
  buckets: {
    range: string;           // e.g., "0.7-0.8"
    rangeMin: number;
    rangeMax: number;
    totalPredictions: number;
    correctOutcomes: number;
    actualAccuracy: number;  // correctOutcomes / totalPredictions
    expectedAccuracy: number; // midpoint of range
    bucketCalibration: number; // actualAccuracy / expectedAccuracy
  }[];
  
  // Aggregate stats
  stats: {
    totalSamples: number;
    overconfidentCount: number;  // Predicted high, outcome low
    underconfidentCount: number; // Predicted low, outcome high
    wellCalibratedCount: number; // Prediction ≈ outcome
    brierScore: number;          // Mean squared error (lower is better)
  };
  
  // Trend
  trend: 'improving' | 'stable' | 'degrading';
  previousFactor: number;
  
  // Metadata
  calculatedAt: Date;
  validUntil: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bucket Schema
 */
const BucketSchema = new Schema(
  {
    range: { type: String, required: true },
    rangeMin: { type: Number, required: true },
    rangeMax: { type: Number, required: true },
    totalPredictions: { type: Number, default: 0 },
    correctOutcomes: { type: Number, default: 0 },
    actualAccuracy: { type: Number, default: 0 },
    expectedAccuracy: { type: Number, required: true },
    bucketCalibration: { type: Number, default: 1 },
  },
  { _id: false }
);

/**
 * Stats Schema
 */
const StatsSchema = new Schema(
  {
    totalSamples: { type: Number, default: 0 },
    overconfidentCount: { type: Number, default: 0 },
    underconfidentCount: { type: Number, default: 0 },
    wellCalibratedCount: { type: Number, default: 0 },
    brierScore: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Confidence Calibration Schema
 */
const ConfidenceCalibrationSchema = new Schema<IConfidenceCalibration>(
  {
    // Subject
    subjectType: {
      type: String,
      enum: ['decision', 'strategy', 'signal'],
      required: true,
      index: true,
    },
    subjectId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Calibration
    calibrationFactor: {
      type: Number,
      required: true,
      min: 0.5,
      max: 1.5,
      default: 1.0,
    },
    
    // Buckets
    buckets: {
      type: [BucketSchema],
      default: [],
    },
    
    // Stats
    stats: {
      type: StatsSchema,
      default: {},
    },
    
    // Trend
    trend: {
      type: String,
      enum: ['improving', 'stable', 'degrading'],
      default: 'stable',
    },
    previousFactor: {
      type: Number,
      default: 1.0,
    },
    
    // Metadata
    calculatedAt: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'confidence_calibration',
  }
);

// Indexes
ConfidenceCalibrationSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });
ConfidenceCalibrationSchema.index({ calibrationFactor: 1 });

export const ConfidenceCalibrationModel = mongoose.model<IConfidenceCalibration>(
  'ConfidenceCalibration',
  ConfidenceCalibrationSchema
);

/**
 * Default confidence buckets
 */
export const DEFAULT_CONFIDENCE_BUCKETS = [
  { range: '0.0-0.2', rangeMin: 0.0, rangeMax: 0.2, expectedAccuracy: 0.1 },
  { range: '0.2-0.4', rangeMin: 0.2, rangeMax: 0.4, expectedAccuracy: 0.3 },
  { range: '0.4-0.6', rangeMin: 0.4, rangeMax: 0.6, expectedAccuracy: 0.5 },
  { range: '0.6-0.8', rangeMin: 0.6, rangeMax: 0.8, expectedAccuracy: 0.7 },
  { range: '0.8-1.0', rangeMin: 0.8, rangeMax: 1.0, expectedAccuracy: 0.9 },
];

/**
 * Calibration validity (hours)
 */
export const CALIBRATION_VALIDITY_HOURS = 24;

/**
 * Calibration bounds
 */
export const CALIBRATION_BOUNDS = {
  min: 0.5,  // System overestimates 2x
  max: 1.5,  // System underestimates 1.5x
};
