/**
 * Actor Profile Model
 * 
 * Aggregates cross-chain behavior of wallets/clusters
 * Built on top of bridge_migrations and watchlist_events
 * 
 * Actor ≠ identity (no deanonymization)
 * Actor = behavioral fingerprint
 */
import mongoose, { Schema, Document, Types } from 'mongoose';
import crypto from 'crypto';

/**
 * Activity Pattern types
 */
export type ActivityPattern = 'burst' | 'steady' | 'event-driven' | 'unknown';

/**
 * Actor confidence level
 */
export type ActorConfidenceLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'IGNORED';

/**
 * Route intelligence
 */
export interface IRouteStats {
  from: string;
  to: string;
  count: number;
  totalVolumeUsd: number;
  avgSizeUsd: number;
}

/**
 * Actor Profile Document
 */
export interface IActorProfile extends Document {
  _id: Types.ObjectId;
  actorId: string;              // deterministic hash
  primaryAddress: string;       // wallet address
  
  // Chain coverage
  chainsUsed: string[];
  chainCount: number;
  
  // Activity stats
  bridgeCount7d: number;
  bridgeCount30d: number;
  totalMigrations: number;
  avgMigrationSizeUsd: number;
  maxMigrationSizeUsd: number;
  totalVolumeUsd: number;
  
  // Route intelligence
  dominantRoutes: IRouteStats[];
  preferredFromChain?: string;
  preferredToChain?: string;
  
  // Temporal behaviour
  activityPattern: ActivityPattern;
  avgTimeBetweenMigrations?: number; // seconds
  
  // Pattern scores (0-1 each)
  patternScores: {
    repeatBridge: number;
    routeDominance: number;
    sizeEscalation: number;
    multiChainPresence: number;
    temporalPattern: number;
  };
  
  // Overall confidence
  confidenceScore: number;
  confidenceLevel: ActorConfidenceLevel;
  
  // Tracking
  firstSeenAt: Date;
  lastActivityAt: Date;
  lastUpdatedAt: Date;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Actor Profile Schema
 */
const ActorProfileSchema = new Schema<IActorProfile>(
  {
    actorId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    primaryAddress: {
      type: String,
      required: true,
      index: true,
    },
    chainsUsed: [{
      type: String,
    }],
    chainCount: {
      type: Number,
      default: 0,
    },
    bridgeCount7d: {
      type: Number,
      default: 0,
    },
    bridgeCount30d: {
      type: Number,
      default: 0,
    },
    totalMigrations: {
      type: Number,
      default: 0,
    },
    avgMigrationSizeUsd: {
      type: Number,
      default: 0,
    },
    maxMigrationSizeUsd: {
      type: Number,
      default: 0,
    },
    totalVolumeUsd: {
      type: Number,
      default: 0,
    },
    dominantRoutes: [{
      from: String,
      to: String,
      count: Number,
      totalVolumeUsd: Number,
      avgSizeUsd: Number,
    }],
    preferredFromChain: String,
    preferredToChain: String,
    activityPattern: {
      type: String,
      enum: ['burst', 'steady', 'event-driven', 'unknown'],
      default: 'unknown',
    },
    avgTimeBetweenMigrations: Number,
    patternScores: {
      repeatBridge: { type: Number, default: 0 },
      routeDominance: { type: Number, default: 0 },
      sizeEscalation: { type: Number, default: 0 },
      multiChainPresence: { type: Number, default: 0 },
      temporalPattern: { type: Number, default: 0 },
    },
    confidenceScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
      index: true,
    },
    confidenceLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'IGNORED'],
      default: 'IGNORED',
      index: true,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'actor_intel_profiles',
  }
);

// Indexes
ActorProfileSchema.index({ chainsUsed: 1 });
ActorProfileSchema.index({ confidenceLevel: 1, lastActivityAt: -1 });

export const ActorProfileModel = mongoose.models.ActorIntelProfile as mongoose.Model<IActorProfile> ||
  mongoose.model<IActorProfile>('ActorIntelProfile', ActorProfileSchema);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate deterministic actorId from wallet address
 */
export function generateActorId(address: string): string {
  const normalized = address.toLowerCase().trim();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return `actor_${hash.slice(0, 16)}`;
}

/**
 * Get confidence level from score
 */
export function getConfidenceLevel(score: number): ActorConfidenceLevel {
  if (score < 0.4) return 'IGNORED';
  if (score < 0.6) return 'LOW';
  if (score < 0.8) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Find or create actor profile
 */
export async function findOrCreateActorProfile(address: string): Promise<IActorProfile> {
  const actorId = generateActorId(address);
  
  let profile = await ActorProfileModel.findOne({ actorId });
  
  if (!profile) {
    profile = await ActorProfileModel.create({
      actorId,
      primaryAddress: address.toLowerCase(),
      chainsUsed: [],
      chainCount: 0,
      dominantRoutes: [],
      patternScores: {
        repeatBridge: 0,
        routeDominance: 0,
        sizeEscalation: 0,
        multiChainPresence: 0,
        temporalPattern: 0,
      },
      confidenceScore: 0,
      confidenceLevel: 'IGNORED',
      firstSeenAt: new Date(),
      lastActivityAt: new Date(),
      lastUpdatedAt: new Date(),
    });
  }
  
  return profile;
}

/**
 * Get actor profiles with filters
 */
export async function getActorProfiles(filters?: {
  confidenceLevel?: ActorConfidenceLevel;
  minConfidence?: number;
  chain?: string;
  limit?: number;
}): Promise<IActorProfile[]> {
  const query: any = {};
  
  if (filters?.confidenceLevel) {
    query.confidenceLevel = filters.confidenceLevel;
  }
  if (filters?.minConfidence) {
    query.confidenceScore = { $gte: filters.minConfidence };
  }
  if (filters?.chain) {
    query.chainsUsed = filters.chain;
  }
  
  return ActorProfileModel.find(query)
    .sort({ confidenceScore: -1, lastActivityAt: -1 })
    .limit(filters?.limit || 50);
}

/**
 * Get actor profile by ID
 */
export async function getActorProfileById(actorId: string): Promise<IActorProfile | null> {
  return ActorProfileModel.findOne({ actorId });
}

/**
 * Get actor profile by wallet address
 */
export async function getActorProfileByAddress(address: string): Promise<IActorProfile | null> {
  const actorId = generateActorId(address);
  return ActorProfileModel.findOne({ actorId });
}
