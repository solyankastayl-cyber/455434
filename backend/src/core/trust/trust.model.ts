/**
 * Trust MongoDB Model (L11.5 - Trust & Transparency Overlay)
 * 
 * Tracks trust scores for decisions based on outcomes.
 * Provides transparency about system reliability.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Trust level
 */
export type TrustLevel = 'low' | 'medium' | 'high' | 'very_high';

/**
 * Trust Document Interface
 */
export interface ITrust extends Document {
  _id: Types.ObjectId;
  
  // Subject
  subjectType: 'decision_type' | 'actor' | 'strategy' | 'system';
  subjectId: string;  // 'follow' | 'copy' | address | 'global'
  
  // Trust metrics
  trustScore: number;  // 0-100
  trustLevel: TrustLevel;
  
  // Components
  components: {
    accuracyScore: number;     // How often decisions are correct
    consistencyScore: number;  // How stable the predictions are
    timelinessScore: number;   // How timely the signals are
    feedbackScore: number;     // User satisfaction
  };
  
  // Stats
  stats: {
    totalDecisions: number;
    followedDecisions: number;
    positiveOutcomes: number;
    negativeOutcomes: number;
    avgUserRating: number;
    sampleSize: number;
  };
  
  // Trend
  trend: 'improving' | 'stable' | 'declining';
  previousScore?: number;
  
  // Confidence interval
  confidence: {
    lower: number;
    upper: number;
    level: number;  // e.g., 0.95 for 95% CI
  };
  
  // Metadata
  calculatedAt: Date;
  validUntil: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Components Schema
 */
const ComponentsSchema = new Schema(
  {
    accuracyScore: { type: Number, default: 50 },
    consistencyScore: { type: Number, default: 50 },
    timelinessScore: { type: Number, default: 50 },
    feedbackScore: { type: Number, default: 50 },
  },
  { _id: false }
);

/**
 * Stats Schema
 */
const StatsSchema = new Schema(
  {
    totalDecisions: { type: Number, default: 0 },
    followedDecisions: { type: Number, default: 0 },
    positiveOutcomes: { type: Number, default: 0 },
    negativeOutcomes: { type: Number, default: 0 },
    avgUserRating: { type: Number, default: 0 },
    sampleSize: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Confidence Schema
 */
const ConfidenceSchema = new Schema(
  {
    lower: { type: Number, default: 0 },
    upper: { type: Number, default: 100 },
    level: { type: Number, default: 0.95 },
  },
  { _id: false }
);

/**
 * Trust Schema
 */
const TrustSchema = new Schema<ITrust>(
  {
    // Subject
    subjectType: {
      type: String,
      enum: ['decision_type', 'actor', 'strategy', 'system'],
      required: true,
      index: true,
    },
    subjectId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Trust metrics
    trustScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    trustLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'very_high'],
      required: true,
    },
    
    // Components
    components: {
      type: ComponentsSchema,
      default: {},
    },
    
    // Stats
    stats: {
      type: StatsSchema,
      default: {},
    },
    
    // Trend
    trend: {
      type: String,
      enum: ['improving', 'stable', 'declining'],
      default: 'stable',
    },
    previousScore: Number,
    
    // Confidence
    confidence: {
      type: ConfidenceSchema,
      default: {},
    },
    
    // Metadata
    calculatedAt: {
      type: Date,
      required: true,
    },
    validUntil: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'trust',
  }
);

// Indexes
TrustSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });
TrustSchema.index({ trustLevel: 1, trustScore: -1 });

export const TrustModel = mongoose.model<ITrust>('Trust', TrustSchema);

/**
 * Trust level thresholds
 */
export const TRUST_LEVEL_THRESHOLDS: Record<TrustLevel, [number, number]> = {
  'low': [0, 40],
  'medium': [40, 60],
  'high': [60, 80],
  'very_high': [80, 100],
};

/**
 * Get trust level from score
 */
export function getTrustLevel(score: number): TrustLevel {
  if (score >= 80) return 'very_high';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

/**
 * Trust validity period (hours)
 */
export const TRUST_VALIDITY_HOURS = 24;

/**
 * Minimum sample size for reliable trust score
 */
export const MIN_SAMPLE_SIZE = 10;
