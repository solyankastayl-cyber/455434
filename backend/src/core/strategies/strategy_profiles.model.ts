/**
 * Strategy Profiles MongoDB Model (L7 - Strategy Layer)
 * 
 * Automatically identifies trading strategies based on on-chain behavior.
 * Bridge to copy-signals, alerts++, monetization.
 * 
 * Key concept: Strategy Profile = behavioral fingerprint, not a label
 * One address can change strategy, have primary + secondary, etc.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Strategy types
 */
export type StrategyType =
  | 'accumulation_sniper'   // Early entry, long hold, low wash
  | 'distribution_whale'    // High outflow, market mover
  | 'momentum_rider'        // Short-term, intensity spikes
  | 'rotation_trader'       // Multi-asset cycling
  | 'wash_operator'         // Suspicious symmetric activity
  | 'liquidity_farmer'      // LP patterns, stable flow
  | 'mixed';                // No dominant strategy

/**
 * All strategy types
 */
export const STRATEGY_TYPES: StrategyType[] = [
  'accumulation_sniper',
  'distribution_whale',
  'momentum_rider',
  'rotation_trader',
  'wash_operator',
  'liquidity_farmer',
  'mixed',
];

/**
 * Risk/Influence levels
 */
export type RiskLevel = 'low' | 'medium' | 'high';
export type InfluenceLevel = 'low' | 'medium' | 'high';

/**
 * Preferred window
 */
export type PreferredWindow = '1d' | '7d' | '30d';

/**
 * Performance proxy metrics
 */
export interface PerformanceProxy {
  consistencyScore: number;
  intensityScore: number;
  behaviorScore: number;
  washRatio: number;
  avgDensity: number;
}

/**
 * Strategy Profile Document Interface
 */
export interface IStrategyProfile extends Document {
  _id: Types.ObjectId;
  
  // Subject identification
  address: string;
  chain: string;
  
  // Strategy classification
  strategyType: StrategyType;
  secondaryStrategy: StrategyType | null;
  
  // Confidence metrics
  confidence: number;      // 0-1, how sure we are
  stability: number;       // 0-1, how consistent over time
  
  // Levels
  riskLevel: RiskLevel;
  influenceLevel: InfluenceLevel;
  
  // Behavioral metrics
  avgHoldingTimeHours: number;
  preferredWindow: PreferredWindow;
  preferredAssets: string[];     // Top 5 ERC-20 addresses
  
  // Performance proxy (from scores/bundles)
  performanceProxy: PerformanceProxy;
  
  // Bundle breakdown (for classification)
  bundleBreakdown: {
    accumulationRatio: number;
    distributionRatio: number;
    rotationRatio: number;
    washRatio: number;
    flowRatio: number;
  };
  
  // History tracking
  previousStrategy: StrategyType | null;
  strategyChangesLast30d: number;
  
  // Timestamps
  detectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Performance Proxy Schema
 */
const PerformanceProxySchema = new Schema<PerformanceProxy>(
  {
    consistencyScore: { type: Number, default: 0 },
    intensityScore: { type: Number, default: 0 },
    behaviorScore: { type: Number, default: 0 },
    washRatio: { type: Number, default: 0 },
    avgDensity: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Bundle Breakdown Schema
 */
const BundleBreakdownSchema = new Schema(
  {
    accumulationRatio: { type: Number, default: 0 },
    distributionRatio: { type: Number, default: 0 },
    rotationRatio: { type: Number, default: 0 },
    washRatio: { type: Number, default: 0 },
    flowRatio: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Strategy Profile Schema
 */
const StrategyProfileSchema = new Schema<IStrategyProfile>(
  {
    // Subject
    address: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      required: true,
      default: 'ethereum',
    },
    
    // Classification
    strategyType: {
      type: String,
      enum: [
        'accumulation_sniper',
        'distribution_whale',
        'momentum_rider',
        'rotation_trader',
        'wash_operator',
        'liquidity_farmer',
        'mixed',
      ],
      required: true,
      index: true,
    },
    secondaryStrategy: {
      type: String,
      enum: [
        'accumulation_sniper',
        'distribution_whale',
        'momentum_rider',
        'rotation_trader',
        'wash_operator',
        'liquidity_farmer',
        'mixed',
        null,
      ],
      default: null,
    },
    
    // Confidence
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
      index: true,
    },
    stability: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0.5,
    },
    
    // Levels
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
      index: true,
    },
    influenceLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
      index: true,
    },
    
    // Behavioral
    avgHoldingTimeHours: {
      type: Number,
      default: 0,
    },
    preferredWindow: {
      type: String,
      enum: ['1d', '7d', '30d'],
      default: '7d',
    },
    preferredAssets: {
      type: [String],
      default: [],
    },
    
    // Performance
    performanceProxy: {
      type: PerformanceProxySchema,
      required: true,
    },
    
    // Bundle breakdown
    bundleBreakdown: {
      type: BundleBreakdownSchema,
      required: true,
    },
    
    // History
    previousStrategy: {
      type: String,
      enum: [
        'accumulation_sniper',
        'distribution_whale',
        'momentum_rider',
        'rotation_trader',
        'wash_operator',
        'liquidity_farmer',
        'mixed',
        null,
      ],
      default: null,
    },
    strategyChangesLast30d: {
      type: Number,
      default: 0,
    },
    
    // Detection timestamp
    detectedAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'strategy_profiles',
  }
);

// ========== INDEXES ==========

// Unique: one profile per address per chain
StrategyProfileSchema.index(
  { address: 1, chain: 1 },
  { unique: true }
);

// For leaderboard queries
StrategyProfileSchema.index({ strategyType: 1, confidence: -1 });
StrategyProfileSchema.index({ influenceLevel: 1, confidence: -1 });

// For filtering
StrategyProfileSchema.index({ riskLevel: 1, strategyType: 1 });

// For recent updates
StrategyProfileSchema.index({ detectedAt: -1 });

export const StrategyProfileModel = mongoose.model<IStrategyProfile>(
  'StrategyProfile',
  StrategyProfileSchema
);

/**
 * Get risk level from score
 */
export function getRiskLevel(riskScore: number): RiskLevel {
  if (riskScore >= 60) return 'high';
  if (riskScore >= 30) return 'medium';
  return 'low';
}

/**
 * Get influence level from score
 */
export function getInfluenceLevel(influenceScore: number): InfluenceLevel {
  if (influenceScore >= 60) return 'high';
  if (influenceScore >= 30) return 'medium';
  return 'low';
}

/**
 * Strategy display names
 */
export const STRATEGY_DISPLAY_NAMES: Record<StrategyType, string> = {
  'accumulation_sniper': 'Accumulation Sniper',
  'distribution_whale': 'Distribution Whale',
  'momentum_rider': 'Momentum Rider',
  'rotation_trader': 'Rotation Trader',
  'wash_operator': 'Wash Operator',
  'liquidity_farmer': 'Liquidity Farmer',
  'mixed': 'Mixed Strategy',
};

/**
 * Strategy descriptions
 */
export const STRATEGY_DESCRIPTIONS: Record<StrategyType, string> = {
  'accumulation_sniper': 'Early entry specialist with long holding periods and consistent accumulation patterns',
  'distribution_whale': 'Large-scale distributor with high market influence and significant outflows',
  'momentum_rider': 'Short-term trader capitalizing on intensity spikes and quick rotations',
  'rotation_trader': 'Multi-asset cycler with consistent rotation patterns across different tokens',
  'wash_operator': 'Suspicious symmetric activity patterns suggesting wash trading behavior',
  'liquidity_farmer': 'Stable flow patterns consistent with liquidity provision strategies',
  'mixed': 'No dominant strategy detected, diverse behavioral patterns',
};
