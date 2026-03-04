/**
 * User Tiers MongoDB Model (L9 - Monetization Hooks)
 * 
 * User tier system for limiting access to features.
 * Backend-only, no billing/UI integration yet.
 * 
 * Tiers:
 * - free: delayed signals, lower confidence only, limited follows/rules
 * - pro: real-time, all signals, more limits
 * - elite: early detection, rare strategies, maximum limits
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Tier types
 */
export type UserTier = 'free' | 'pro' | 'elite';

/**
 * Tier limits
 */
export interface TierLimits {
  follows: number;              // Max follows
  alertRules: number;           // Max alert rules
  strategySignalsPerDay: number; // Max strategy signals visible per day
  historicalDepthDays: number;   // How far back can access data
  signalDelay: number;           // Delay in seconds for signals
  minConfidenceAccess: number;   // Min confidence signals visible (0-1)
  rareStrategiesAccess: boolean; // Access to rare strategy signals
  apiRateLimit: number;          // Requests per minute
}

/**
 * Default limits per tier
 */
export const TIER_LIMITS: Record<UserTier, TierLimits> = {
  free: {
    follows: 5,
    alertRules: 3,
    strategySignalsPerDay: 20,
    historicalDepthDays: 7,
    signalDelay: 300, // 5 minutes
    minConfidenceAccess: 0.7, // Only high confidence
    rareStrategiesAccess: false,
    apiRateLimit: 30,
  },
  pro: {
    follows: 50,
    alertRules: 20,
    strategySignalsPerDay: 500,
    historicalDepthDays: 30,
    signalDelay: 0, // Real-time
    minConfidenceAccess: 0.5,
    rareStrategiesAccess: true,
    apiRateLimit: 120,
  },
  elite: {
    follows: 500,
    alertRules: 100,
    strategySignalsPerDay: 10000,
    historicalDepthDays: 90,
    signalDelay: 0,
    minConfidenceAccess: 0, // All signals
    rareStrategiesAccess: true,
    apiRateLimit: 300,
  },
};

/**
 * Rare strategies (only for pro+)
 */
export const RARE_STRATEGIES = [
  'rotation_trader',
  'distribution_whale',
  'accumulation_sniper',
];

/**
 * User Tier Document Interface
 */
export interface IUserTier extends Document {
  _id: Types.ObjectId;
  
  userId: string;
  tier: UserTier;
  
  // Custom limits (override defaults)
  customLimits?: Partial<TierLimits>;
  
  // Usage tracking
  usage: {
    signalsToday: number;
    signalsDate: Date;
    apiRequestsMinute: number;
    apiRequestsTimestamp: Date;
  };
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Usage Schema
 */
const UsageSchema = new Schema(
  {
    signalsToday: { type: Number, default: 0 },
    signalsDate: { type: Date, default: () => new Date() },
    apiRequestsMinute: { type: Number, default: 0 },
    apiRequestsTimestamp: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

/**
 * User Tier Schema
 */
const UserTierSchema = new Schema<IUserTier>(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    tier: {
      type: String,
      enum: ['free', 'pro', 'elite'],
      default: 'free',
      index: true,
    },
    customLimits: {
      type: Schema.Types.Mixed,
    },
    usage: {
      type: UsageSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
    collection: 'user_tiers',
  }
);

export const UserTierModel = mongoose.model<IUserTier>('UserTier', UserTierSchema);

/**
 * Get effective limits for a user tier
 */
export function getEffectiveLimits(tier: IUserTier): TierLimits {
  const baseLimits = TIER_LIMITS[tier.tier];
  
  if (!tier.customLimits) return baseLimits;
  
  return {
    ...baseLimits,
    ...tier.customLimits,
  };
}

/**
 * Check if strategy is rare
 */
export function isRareStrategy(strategyType: string): boolean {
  return RARE_STRATEGIES.includes(strategyType);
}
