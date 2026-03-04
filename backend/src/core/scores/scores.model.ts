/**
 * Scores MongoDB Model (L5 - Rating Core)
 * 
 * Aggregates on-chain behavior into numerical ratings.
 * Used by: UI (colors, badges, sorting), Actors, Entities, Watchlist, Alerts
 * 
 * Key principle: Scores explain "who is who", NOT trigger signals
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Subject types that can have scores
 */
export type ScoreSubjectType = 'address' | 'actor' | 'entity';

/**
 * Score windows
 */
export type ScoreWindow = '7d' | '30d' | '90d';

/**
 * Score breakdown details
 */
export interface ScoreBreakdown {
  // Behavior metrics
  accumulationRatio: number;
  distributionRatio: number;
  washRatio: number;
  rotationFrequency: number;
  flowBalance: number;
  
  // Intensity metrics
  avgDensity: number;
  peakDensity: number;
  intensitySpikes: number;
  volumeWeighted: number;
  
  // Consistency metrics
  activeDaysRatio: number;
  stdDevDensity: number;
  signalNoiseRatio: number;
  
  // Risk factors
  washDetectedCount: number;
  sharpReversals: number;
  burstOnlyBehavior: boolean;
  highVariance: boolean;
  
  // Influence factors
  followersCount: number;
  avgFollowerLag: number;
  frontRunRatio: number;
  
  // Counts
  signalCount: number;
  bundleCount: number;
  relationCount: number;
  transferCount: number;
}

/**
 * Score Document Interface
 */
export interface IScore extends Document {
  _id: Types.ObjectId;
  
  // Subject identification
  subjectType: ScoreSubjectType;
  subjectId: string;
  
  // Time window
  window: ScoreWindow;
  
  // Individual scores (0-100)
  behaviorScore: number;
  intensityScore: number;
  consistencyScore: number;
  riskScore: number;
  influenceScore: number;
  
  // Composite score (0-100)
  compositeScore: number;
  
  // Color tier for UI
  tier: 'green' | 'yellow' | 'orange' | 'red';
  
  // Detailed breakdown
  breakdown: ScoreBreakdown;
  
  // Chain
  chain: string;
  
  // Timestamps
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Score Schema
 */
const ScoreBreakdownSchema = new Schema<ScoreBreakdown>(
  {
    // Behavior
    accumulationRatio: { type: Number, default: 0 },
    distributionRatio: { type: Number, default: 0 },
    washRatio: { type: Number, default: 0 },
    rotationFrequency: { type: Number, default: 0 },
    flowBalance: { type: Number, default: 0 },
    
    // Intensity
    avgDensity: { type: Number, default: 0 },
    peakDensity: { type: Number, default: 0 },
    intensitySpikes: { type: Number, default: 0 },
    volumeWeighted: { type: Number, default: 0 },
    
    // Consistency
    activeDaysRatio: { type: Number, default: 0 },
    stdDevDensity: { type: Number, default: 0 },
    signalNoiseRatio: { type: Number, default: 0 },
    
    // Risk
    washDetectedCount: { type: Number, default: 0 },
    sharpReversals: { type: Number, default: 0 },
    burstOnlyBehavior: { type: Boolean, default: false },
    highVariance: { type: Boolean, default: false },
    
    // Influence
    followersCount: { type: Number, default: 0 },
    avgFollowerLag: { type: Number, default: 0 },
    frontRunRatio: { type: Number, default: 0 },
    
    // Counts
    signalCount: { type: Number, default: 0 },
    bundleCount: { type: Number, default: 0 },
    relationCount: { type: Number, default: 0 },
    transferCount: { type: Number, default: 0 },
  },
  { _id: false }
);

const ScoreSchema = new Schema<IScore>(
  {
    // Subject identification
    subjectType: {
      type: String,
      enum: ['address', 'actor', 'entity'],
      required: true,
      index: true,
    },
    subjectId: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Window
    window: {
      type: String,
      enum: ['7d', '30d', '90d'],
      required: true,
      index: true,
    },
    
    // Individual scores
    behaviorScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
    },
    intensityScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
    },
    consistencyScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
    },
    riskScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    influenceScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    
    // Composite
    compositeScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      default: 50,
      index: true,
    },
    
    // Tier
    tier: {
      type: String,
      enum: ['green', 'yellow', 'orange', 'red'],
      required: true,
      index: true,
    },
    
    // Breakdown
    breakdown: {
      type: ScoreBreakdownSchema,
      required: true,
    },
    
    // Chain
    chain: {
      type: String,
      required: true,
      default: 'ethereum',
    },
    
    // Calculated timestamp
    calculatedAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'scores',
  }
);

// ========== INDEXES ==========

// Unique constraint: one score per subject per window
ScoreSchema.index(
  { subjectType: 1, subjectId: 1, window: 1 },
  { unique: true }
);

// For leaderboard queries
ScoreSchema.index({ compositeScore: -1, subjectType: 1 });
ScoreSchema.index({ influenceScore: -1, subjectType: 1 });
ScoreSchema.index({ riskScore: -1, subjectType: 1 });

// For tier-based filtering
ScoreSchema.index({ tier: 1, compositeScore: -1 });

// For recent updates
ScoreSchema.index({ calculatedAt: -1 });

export const ScoreModel = mongoose.model<IScore>('Score', ScoreSchema);

/**
 * Get tier from composite score
 */
export function getTierFromScore(score: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

/**
 * Calculate composite score from individual scores
 * Formula: BS*0.25 + IS*0.25 + CS*0.20 + INF*0.20 - RS*0.20
 */
export function calculateCompositeScore(
  behaviorScore: number,
  intensityScore: number,
  consistencyScore: number,
  riskScore: number,
  influenceScore: number
): number {
  const raw = 
    behaviorScore * 0.25 +
    intensityScore * 0.25 +
    consistencyScore * 0.20 +
    influenceScore * 0.20 -
    riskScore * 0.20;
  
  // Normalize to 0-100
  return Math.max(0, Math.min(100, raw + 20)); // +20 to offset risk penalty
}
