/**
 * Strategy Signals MongoDB Model (L7.1 - Strategy Event Layer)
 * 
 * High-level actionable signals derived from strategy profiles.
 * These are "money signals" - not just events, but interpretations + actions.
 * 
 * Built FROM: strategy_profiles + scores + bundles
 * Used BY: alerts, follow engine, notifications, monetization
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Strategy Signal Types
 */
export type StrategySignalType =
  | 'strategy_detected'       // Strategy identified for first time
  | 'strategy_shift'          // Strategy type changed
  | 'strategy_phase_change'   // Phase within strategy changed (accum -> distrib)
  | 'strategy_intensity_spike' // Sudden activity increase in strategy
  | 'strategy_risk_spike'     // Risk level increased significantly
  | 'strategy_influence_jump' // Influence score jumped
  | 'strategy_confirmed';     // Strategy became stable/confirmed

/**
 * Strategy Signal Evidence
 */
export interface StrategySignalEvidence {
  // Scores snapshot
  behaviorScore: number;
  intensityScore: number;
  consistencyScore: number;
  riskScore: number;
  influenceScore: number;
  compositeScore: number;
  
  // Strategy metrics
  confidence: number;
  stability: number;
  
  // Bundle breakdown
  accumulationRatio: number;
  distributionRatio: number;
  washRatio: number;
  rotationRatio: number;
  
  // Change deltas (if applicable)
  confidenceDelta?: number;
  stabilityDelta?: number;
  scoreDelta?: number;
}

/**
 * Dedup configuration per signal type (in hours)
 */
export const STRATEGY_SIGNAL_DEDUP_HOURS: Record<StrategySignalType, number> = {
  'strategy_detected': 24,
  'strategy_confirmed': 48,
  'strategy_shift': 12,
  'strategy_phase_change': 12,
  'strategy_intensity_spike': 6,
  'strategy_risk_spike': 6,
  'strategy_influence_jump': 12,
};

/**
 * Strategy Signal Document Interface
 */
export interface IStrategySignal extends Document {
  _id: Types.ObjectId;
  
  // Subject identification
  actorAddress: string;
  chain: string;
  window: '7d' | '30d' | '90d';
  
  // Signal classification
  type: StrategySignalType;
  strategyType: string;  // Current strategy type
  previousStrategyType?: string;  // For shifts
  
  // Scores
  severity: number;      // 0-100
  confidence: number;    // 0-1
  stability: number;     // 0-1
  
  // Deduplication
  dedupKey: string;
  dedupUntil: Date;
  
  // Content
  explanation: string;
  evidence: StrategySignalEvidence;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Evidence Schema
 */
const StrategySignalEvidenceSchema = new Schema<StrategySignalEvidence>(
  {
    behaviorScore: { type: Number, default: 0 },
    intensityScore: { type: Number, default: 0 },
    consistencyScore: { type: Number, default: 0 },
    riskScore: { type: Number, default: 0 },
    influenceScore: { type: Number, default: 0 },
    compositeScore: { type: Number, default: 0 },
    confidence: { type: Number, default: 0 },
    stability: { type: Number, default: 0 },
    accumulationRatio: { type: Number, default: 0 },
    distributionRatio: { type: Number, default: 0 },
    washRatio: { type: Number, default: 0 },
    rotationRatio: { type: Number, default: 0 },
    confidenceDelta: { type: Number },
    stabilityDelta: { type: Number },
    scoreDelta: { type: Number },
  },
  { _id: false }
);

/**
 * Strategy Signal Schema
 */
const StrategySignalSchema = new Schema<IStrategySignal>(
  {
    // Subject
    actorAddress: {
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
    window: {
      type: String,
      enum: ['7d', '30d', '90d'],
      required: true,
      index: true,
    },
    
    // Classification
    type: {
      type: String,
      enum: [
        'strategy_detected',
        'strategy_shift',
        'strategy_phase_change',
        'strategy_intensity_spike',
        'strategy_risk_spike',
        'strategy_influence_jump',
        'strategy_confirmed',
      ],
      required: true,
      index: true,
    },
    strategyType: {
      type: String,
      required: true,
      index: true,
    },
    previousStrategyType: {
      type: String,
    },
    
    // Scores
    severity: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
      index: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      index: true,
    },
    stability: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    
    // Deduplication
    dedupKey: {
      type: String,
      required: true,
      index: true,
    },
    dedupUntil: {
      type: Date,
      required: true,
      index: true,
    },
    
    // Content
    explanation: {
      type: String,
      required: true,
    },
    evidence: {
      type: StrategySignalEvidenceSchema,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: 'strategy_signals',
  }
);

// ========== INDEXES ==========

// For latest signals feed
StrategySignalSchema.index({ createdAt: -1 });
StrategySignalSchema.index({ createdAt: -1, type: 1 });
StrategySignalSchema.index({ createdAt: -1, window: 1 });

// For actor queries
StrategySignalSchema.index({ actorAddress: 1, createdAt: -1 });

// For severity filtering
StrategySignalSchema.index({ severity: -1, createdAt: -1 });

// For dedup checks
StrategySignalSchema.index({ dedupKey: 1, dedupUntil: 1 });

// Compound for strategy type queries
StrategySignalSchema.index({ strategyType: 1, severity: -1 });

export const StrategySignalModel = mongoose.model<IStrategySignal>(
  'StrategySignal',
  StrategySignalSchema
);

/**
 * Calculate severity score
 * 
 * Formula:
 * severity = clamp(0.45*Intensity + 0.35*Influence + 0.20*Behavior - 0.30*Risk, 0..100)
 * + bonus for rare strategies with high confidence
 */
export function calculateStrategySeverity(
  intensityScore: number,
  influenceScore: number,
  behaviorScore: number,
  riskScore: number,
  strategyType: string,
  confidence: number
): number {
  // Base calculation
  let severity = 
    intensityScore * 0.45 +
    influenceScore * 0.35 +
    behaviorScore * 0.20 -
    riskScore * 0.30;
  
  // Bonus for rare strategies with high confidence
  const rareStrategies = ['rotation_trader', 'distribution_whale', 'accumulation_sniper'];
  if (rareStrategies.includes(strategyType) && confidence > 0.7) {
    severity += 10;
  }
  
  // Penalty for wash operators
  if (strategyType === 'wash_operator') {
    severity -= 15;
  }
  
  return Math.max(0, Math.min(100, severity));
}

/**
 * Generate dedup key
 */
export function generateDedupKey(
  actorAddress: string,
  type: StrategySignalType,
  window: string
): string {
  return `${actorAddress}:${type}:${window}`;
}

/**
 * Calculate dedup until time
 */
export function calculateDedupUntil(type: StrategySignalType): Date {
  const hours = STRATEGY_SIGNAL_DEDUP_HOURS[type] || 12;
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

/**
 * Generate explanation text
 */
export function generateStrategyExplanation(
  type: StrategySignalType,
  strategyType: string,
  previousStrategyType?: string,
  confidence?: number,
  stability?: number
): string {
  const confPct = confidence ? Math.round(confidence * 100) : 0;
  const stabPct = stability ? Math.round(stability * 100) : 0;
  
  const strategyNames: Record<string, string> = {
    'accumulation_sniper': 'Accumulation Sniper',
    'distribution_whale': 'Distribution Whale',
    'momentum_rider': 'Momentum Rider',
    'rotation_trader': 'Rotation Trader',
    'wash_operator': 'Wash Operator',
    'liquidity_farmer': 'Liquidity Farmer',
    'mixed': 'Mixed Strategy',
  };
  
  const stratName = strategyNames[strategyType] || strategyType;
  const prevName = previousStrategyType ? (strategyNames[previousStrategyType] || previousStrategyType) : null;
  
  switch (type) {
    case 'strategy_detected':
      return `New ${stratName} strategy detected with ${confPct}% confidence. This actor shows consistent ${strategyType.replace('_', ' ')} behavior patterns.`;
    
    case 'strategy_confirmed':
      return `${stratName} strategy confirmed with ${stabPct}% stability. High confidence classification suggests reliable behavioral pattern.`;
    
    case 'strategy_shift':
      return `Strategy shift: ${prevName || 'Unknown'} → ${stratName}. Significant change in trading behavior detected.`;
    
    case 'strategy_phase_change':
      return `Phase change within ${stratName} strategy. Actor transitioning between accumulation and distribution phases.`;
    
    case 'strategy_intensity_spike':
      return `Intensity spike detected for ${stratName}. Sudden increase in activity volume and frequency.`;
    
    case 'strategy_risk_spike':
      return `⚠️ Risk spike for ${stratName}. Elevated risk indicators detected - review activity carefully.`;
    
    case 'strategy_influence_jump':
      return `Influence jump for ${stratName}. This actor's market influence has increased significantly.`;
    
    default:
      return `Strategy signal: ${type} for ${stratName}`;
  }
}
