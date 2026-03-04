/**
 * Actor Profiles MongoDB Model (L10.1 - Explainable Profiles)
 * 
 * Aggregated read-model for actors.
 * NOT used for calculations — rebuilt by job.
 * UI loads 1 document instead of 12 API calls.
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Score tier classification
 */
export type ScoreTier = 'elite' | 'green' | 'yellow' | 'red' | 'unknown';

/**
 * Scores snapshot
 */
export interface ProfileScores {
  behavior: number;
  intensity: number;
  consistency: number;
  risk: number;
  influence: number;
  composite: number;
  tier: ScoreTier;
}

/**
 * Bundle summary for profile
 */
export interface BundleSummary {
  bundleType: string;
  count: number;
  volumeUsd: number;
  avgConfidence: number;
  lastSeen: Date;
}

/**
 * Signal summary for profile
 */
export interface SignalSummary {
  type: string;
  severity: string;  // 'low' | 'medium' | 'high' | 'critical'
  confidence: number;
  createdAt: Date;
  explanation?: string;
}

/**
 * Asset exposure
 */
export interface AssetExposure {
  asset: string;
  symbol?: string;
  volumeUsd: number;
  percentage: number;
  direction: 'inbound' | 'outbound' | 'balanced';
}

/**
 * Relation summary
 */
export interface RelationSummary {
  counterparty: string;
  label?: string;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  transferCount: number;
  volumeUsd: number;
  lastInteraction: Date;
}

/**
 * Strategy summary
 */
export interface StrategySummary {
  strategyType: string;
  confidence: number;
  stability: number;
  preferredWindow: string;
  phase?: string;
  detectedAt?: Date;
}

/**
 * Actor Profile Document Interface
 */
export interface IActorProfile extends Document {
  _id: Types.ObjectId;
  
  // Identity
  address: string;
  chain: string;
  label?: string;
  entityId?: string;
  
  // Strategy
  strategy: StrategySummary | null;
  
  // Scores
  scores: ProfileScores;
  
  // Aggregations
  topBundles: BundleSummary[];
  recentSignals: SignalSummary[];
  dominantAssets: AssetExposure[];
  activeRelations: RelationSummary[];
  
  // Stats
  stats: {
    totalTransfers: number;
    totalVolumeUsd: number;
    firstSeen: Date | null;
    lastSeen: Date | null;
    uniqueCounterparties: number;
  };
  
  // Metadata
  profileVersion: number;
  lastUpdated: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Profile Scores Schema
 */
const ProfileScoresSchema = new Schema<ProfileScores>(
  {
    behavior: { type: Number, default: 50 },
    intensity: { type: Number, default: 50 },
    consistency: { type: Number, default: 50 },
    risk: { type: Number, default: 50 },
    influence: { type: Number, default: 50 },
    composite: { type: Number, default: 50 },
    tier: { type: String, enum: ['elite', 'green', 'yellow', 'red', 'unknown'], default: 'unknown' },
  },
  { _id: false }
);

/**
 * Bundle Summary Schema
 */
const BundleSummarySchema = new Schema<BundleSummary>(
  {
    bundleType: { type: String, required: true },
    count: { type: Number, default: 0 },
    volumeUsd: { type: Number, default: 0 },
    avgConfidence: { type: Number, default: 0 },
    lastSeen: { type: Date },
  },
  { _id: false }
);

/**
 * Signal Summary Schema
 */
const SignalSummarySchema = new Schema<SignalSummary>(
  {
    type: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    confidence: { type: Number, default: 0 },
    createdAt: { type: Date },
    explanation: { type: String },
  },
  { _id: false }
);

/**
 * Asset Exposure Schema
 */
const AssetExposureSchema = new Schema<AssetExposure>(
  {
    asset: { type: String, required: true },
    symbol: { type: String },
    volumeUsd: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    direction: { type: String, enum: ['inbound', 'outbound', 'balanced'], default: 'balanced' },
  },
  { _id: false }
);

/**
 * Relation Summary Schema
 */
const RelationSummarySchema = new Schema<RelationSummary>(
  {
    counterparty: { type: String, required: true },
    label: { type: String },
    direction: { type: String, enum: ['inbound', 'outbound', 'bidirectional'], default: 'bidirectional' },
    transferCount: { type: Number, default: 0 },
    volumeUsd: { type: Number, default: 0 },
    lastInteraction: { type: Date },
  },
  { _id: false }
);

/**
 * Strategy Summary Schema
 */
const StrategySummarySchema = new Schema<StrategySummary>(
  {
    strategyType: { type: String, required: true },
    confidence: { type: Number, default: 0 },
    stability: { type: Number, default: 0 },
    preferredWindow: { type: String, default: '7d' },
    phase: { type: String },
    detectedAt: { type: Date },
  },
  { _id: false }
);

/**
 * Stats Schema
 */
const StatsSchema = new Schema(
  {
    totalTransfers: { type: Number, default: 0 },
    totalVolumeUsd: { type: Number, default: 0 },
    firstSeen: { type: Date },
    lastSeen: { type: Date },
    uniqueCounterparties: { type: Number, default: 0 },
  },
  { _id: false }
);

/**
 * Actor Profile Schema
 */
const ActorProfileSchema = new Schema<IActorProfile>(
  {
    // Identity
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    chain: {
      type: String,
      default: 'ethereum',
    },
    label: {
      type: String,
    },
    entityId: {
      type: String,
      index: true,
    },
    
    // Strategy
    strategy: {
      type: StrategySummarySchema,
      default: null,
    },
    
    // Scores
    scores: {
      type: ProfileScoresSchema,
      default: () => ({}),
    },
    
    // Aggregations
    topBundles: {
      type: [BundleSummarySchema],
      default: [],
    },
    recentSignals: {
      type: [SignalSummarySchema],
      default: [],
    },
    dominantAssets: {
      type: [AssetExposureSchema],
      default: [],
    },
    activeRelations: {
      type: [RelationSummarySchema],
      default: [],
    },
    
    // Stats
    stats: {
      type: StatsSchema,
      default: () => ({}),
    },
    
    // Metadata
    profileVersion: {
      type: Number,
      default: 1,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'actor_profiles',
  }
);

// ========== INDEXES ==========
ActorProfileSchema.index({ 'scores.composite': -1 });
ActorProfileSchema.index({ 'scores.tier': 1 });
ActorProfileSchema.index({ 'strategy.strategyType': 1 });
ActorProfileSchema.index({ lastUpdated: -1 });

export const ActorProfileModel = mongoose.model<IActorProfile>('ActorProfile', ActorProfileSchema);

/**
 * Calculate score tier from composite score
 */
export function calculateScoreTier(composite: number): ScoreTier {
  if (composite >= 80) return 'elite';
  if (composite >= 60) return 'green';
  if (composite >= 40) return 'yellow';
  if (composite >= 0) return 'red';
  return 'unknown';
}
