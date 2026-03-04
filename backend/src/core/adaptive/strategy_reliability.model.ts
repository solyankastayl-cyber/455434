/**
 * Strategy Reliability Model (Phase 12A.4)
 * 
 * Learns which strategies are actually reliable over time.
 * Unlike static stability score, this adapts based on outcomes.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Strategy Reliability Document Interface
 */
export interface IStrategyReliability extends Document {
  _id: Types.ObjectId;
  
  // Strategy identification
  strategyType: string;  // e.g., 'accumulation_sniper', 'distribution_whale'
  
  // Reliability metrics
  reliabilityScore: number;      // 0-1, learned reliability
  baseReliability: number;       // Initial reliability from strategy profile
  
  // Performance tracking
  performance: {
    totalDecisions: number;
    positiveOutcomes: number;
    negativeOutcomes: number;
    neutralOutcomes: number;
    outcomeRate: number;          // positiveOutcomes / totalDecisions
    
    avgConfidence: number;        // Average confidence of decisions
    avgActualAccuracy: number;    // Actual accuracy
    confidenceAccuracyGap: number; // Gap between predicted and actual
    
    consistencyScore: number;     // How consistent are outcomes
    volatilityScore: number;      // How volatile is performance
  };
  
  // Time-based analysis
  recentPerformance: {
    last7d: { decisions: number; successRate: number };
    last30d: { decisions: number; successRate: number };
    last90d: { decisions: number; successRate: number };
  };
  
  // Trend
  trend: 'improving' | 'stable' | 'declining';
  trendStrength: number;  // 0-1
  
  // Recommendation
  recommendedForCopy: boolean;
  recommendedForFollow: boolean;
  warningFlags: string[];  // e.g., ['high_volatility', 'declining_trend']
  
  // Audit
  lastCalculatedAt: Date;
  sampleSize: number;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Performance Schema
 */
const PerformanceSchema = new Schema(
  {
    totalDecisions: { type: Number, default: 0 },
    positiveOutcomes: { type: Number, default: 0 },
    negativeOutcomes: { type: Number, default: 0 },
    neutralOutcomes: { type: Number, default: 0 },
    outcomeRate: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    avgActualAccuracy: { type: Number, default: 0 },
    confidenceAccuracyGap: { type: Number, default: 0 },
    consistencyScore: { type: Number, default: 0.5 },
    volatilityScore: { type: Number, default: 0.5 },
  },
  { _id: false }
);

/**
 * Recent Performance Schema
 */
const RecentPerformanceSchema = new Schema(
  {
    last7d: {
      decisions: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 },
    },
    last30d: {
      decisions: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 },
    },
    last90d: {
      decisions: { type: Number, default: 0 },
      successRate: { type: Number, default: 0 },
    },
  },
  { _id: false }
);

/**
 * Strategy Reliability Schema
 */
const StrategyReliabilitySchema = new Schema<IStrategyReliability>(
  {
    strategyType: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // Reliability
    reliabilityScore: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    baseReliability: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    
    // Performance
    performance: {
      type: PerformanceSchema,
      default: {},
    },
    
    // Recent
    recentPerformance: {
      type: RecentPerformanceSchema,
      default: {},
    },
    
    // Trend
    trend: {
      type: String,
      enum: ['improving', 'stable', 'declining'],
      default: 'stable',
    },
    trendStrength: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    
    // Recommendations
    recommendedForCopy: {
      type: Boolean,
      default: false,
    },
    recommendedForFollow: {
      type: Boolean,
      default: true,
    },
    warningFlags: {
      type: [String],
      default: [],
    },
    
    // Audit
    lastCalculatedAt: {
      type: Date,
      required: true,
    },
    sampleSize: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    collection: 'strategy_reliability',
  }
);

// Indexes
StrategyReliabilitySchema.index({ reliabilityScore: -1 });
StrategyReliabilitySchema.index({ recommendedForCopy: 1, reliabilityScore: -1 });

export const StrategyReliabilityModel = mongoose.model<IStrategyReliability>(
  'StrategyReliability',
  StrategyReliabilitySchema
);

/**
 * Strategy types from Phase 7
 */
export const STRATEGY_TYPES = [
  'accumulation_sniper',
  'distribution_whale',
  'momentum_rider',
  'rotation_trader',
  'wash_operator',
  'liquidity_farmer',
  'mixed',
];

/**
 * Default base reliability per strategy type
 */
export const BASE_STRATEGY_RELIABILITY: Record<string, number> = {
  'accumulation_sniper': 0.65,   // Generally reliable
  'distribution_whale': 0.60,   // Somewhat reliable
  'momentum_rider': 0.45,       // Less reliable (timing dependent)
  'rotation_trader': 0.50,      // Medium reliability
  'wash_operator': 0.20,        // Low reliability (intentionally)
  'liquidity_farmer': 0.55,     // Medium-high reliability
  'mixed': 0.40,                // Low reliability (unclear pattern)
};

/**
 * Thresholds for recommendations
 */
export const RELIABILITY_THRESHOLDS = {
  copyRecommended: 0.65,   // High bar for copy
  followRecommended: 0.45, // Lower bar for follow
  warningVolatility: 0.7,  // Volatility score threshold
  warningDecline: 0.6,     // Trend strength for decline warning
};
