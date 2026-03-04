/**
 * Trust Snapshots Model (Phase 15.4)
 * 
 * UI-ready trust indicators and explanations.
 * Provides human-readable trust information without computation.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

export type TargetType = 'signal' | 'strategy' | 'actor';

export interface ITrustSnapshot extends Document {
  _id: Types.ObjectId;
  
  // Target reference
  targetType: TargetType;
  targetId: string;                 // signalId, strategyType, or address
  
  // Trust score
  trustScore: number;               // 0-100
  
  // UI badges
  badges: string[];                 // e.g., ["High Accuracy", "Volatile Performance"]
  
  // Explanation
  explanation: string;              // Human-readable summary
  
  // Strengths
  strengths: string[];              // Positive aspects
  
  // Weaknesses
  weaknesses: string[];             // Risk factors
  
  // Recommendations
  recommendation: string;           // Action suggestion
  
  // Data quality
  dataQuality: {
    hasSufficientData: boolean;
    sampleSize: number;
    confidence: number;             // 0-1
    warning?: string;
  };
  
  // Context
  context: {
    bestIn?: string;                // "trend markets"
    worstIn?: string;               // "high volatility"
    timeframe?: string;             // "last 30 days"
  };
  
  // Metadata
  updatedAt: Date;
  computedAt: Date;
  
  createdAt: Date;
}

const DataQualitySchema = new Schema(
  {
    hasSufficientData: { type: Boolean, required: true },
    sampleSize: { type: Number, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    warning: String,
  },
  { _id: false }
);

const ContextSchema = new Schema(
  {
    bestIn: String,
    worstIn: String,
    timeframe: String,
  },
  { _id: false }
);

const TrustSnapshotSchema = new Schema<ITrustSnapshot>(
  {
    targetType: {
      type: String,
      enum: ['signal', 'strategy', 'actor'],
      required: true,
      index: true,
    },
    
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    
    trustScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
    
    badges: {
      type: [String],
      default: [],
    },
    
    explanation: {
      type: String,
      required: true,
    },
    
    strengths: {
      type: [String],
      default: [],
    },
    
    weaknesses: {
      type: [String],
      default: [],
    },
    
    recommendation: {
      type: String,
      required: true,
    },
    
    dataQuality: {
      type: DataQualitySchema,
      required: true,
    },
    
    context: {
      type: ContextSchema,
      default: {},
    },
    
    updatedAt: {
      type: Date,
      required: true,
    },
    
    computedAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'trust_snapshots',
  }
);

// Unique index on target
TrustSnapshotSchema.index({ targetType: 1, targetId: 1 }, { unique: true });
TrustSnapshotSchema.index({ trustScore: -1 });

export const TrustSnapshotModel = mongoose.model<ITrustSnapshot>(
  'TrustSnapshot',
  TrustSnapshotSchema
);

/**
 * Badge templates
 */
export const TRUST_BADGES = {
  // Positive badges
  HIGH_ACCURACY: 'High Accuracy',
  CONSISTENT: 'Consistent Performance',
  PROVEN_TRACK_RECORD: 'Proven Track Record',
  ADAPTS_WELL: 'Adapts to Market Conditions',
  LOW_RISK: 'Low Risk Profile',
  TREND_SPECIALIST: 'Trend Specialist',
  VOLATILE_SPECIALIST: 'High Volatility Specialist',
  
  // Warning badges
  NEW_SIGNAL: 'New Signal',
  LIMITED_DATA: 'Limited Historical Data',
  VOLATILE_PERFORMANCE: 'Volatile Performance',
  HIGH_DRAWDOWN: 'High Drawdown Risk',
  INCONSISTENT: 'Inconsistent Results',
  UNDERPERFORMS_VOLATILE: 'Underperforms in Volatility',
  REGIME_DEPENDENT: 'Regime Dependent',
};
