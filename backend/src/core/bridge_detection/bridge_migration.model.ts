/**
 * Bridge Migration Model
 * 
 * Stores detected cross-chain liquidity migrations
 * 
 * Migration = same wallet moves liquidity from Chain A to Chain B
 * within a time window, with similar amounts
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Bridge Migration Document Interface
 */
export interface IBridgeMigration extends Document {
  _id: Types.ObjectId;
  migrationId: string;
  
  // Wallet/Actor info
  wallet: string;
  actorId?: string;
  
  // Token info
  token: string;           // USDC, USDT, ETH, WETH, DAI
  tokenNormalized: string; // Normalized (ETH=WETH)
  
  // Chain movement
  fromChain: string;
  toChain: string;
  
  // Amounts
  amountFrom: number;
  amountTo: number;
  amountDeltaPct: number;  // (to - from) / from * 100
  
  // Timing
  startedAt: Date;         // First event timestamp
  completedAt: Date;       // Second event timestamp
  windowSeconds: number;   // Time between events
  
  // Confidence
  confidence: number;      // 0.0 - 1.0
  confidenceFactors: {
    amountSimilarity: number;
    timeProximity: number;
    tokenMatch: number;
  };
  
  // Source tracking
  sourceEventIds: string[];
  sourceEventTypes: string[];  // e.g., ['BRIDGE_OUT', 'BRIDGE_IN']
  
  // Status
  status: 'DETECTED' | 'CONFIRMED' | 'FALSE_POSITIVE';
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bridge Migration Schema
 */
const BridgeMigrationSchema = new Schema<IBridgeMigration>(
  {
    migrationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    wallet: {
      type: String,
      required: true,
      index: true,
    },
    actorId: {
      type: String,
      index: true,
    },
    token: {
      type: String,
      required: true,
      index: true,
    },
    tokenNormalized: {
      type: String,
      required: true,
    },
    fromChain: {
      type: String,
      required: true,
      index: true,
    },
    toChain: {
      type: String,
      required: true,
      index: true,
    },
    amountFrom: {
      type: Number,
      required: true,
    },
    amountTo: {
      type: Number,
      required: true,
    },
    amountDeltaPct: {
      type: Number,
      required: true,
    },
    startedAt: {
      type: Date,
      required: true,
      index: true,
    },
    completedAt: {
      type: Date,
      required: true,
    },
    windowSeconds: {
      type: Number,
      required: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      index: true,
    },
    confidenceFactors: {
      amountSimilarity: Number,
      timeProximity: Number,
      tokenMatch: Number,
    },
    sourceEventIds: [{
      type: String,
    }],
    sourceEventTypes: [{
      type: String,
    }],
    status: {
      type: String,
      enum: ['DETECTED', 'CONFIRMED', 'FALSE_POSITIVE'],
      default: 'DETECTED',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'bridge_migrations',
  }
);

// Compound indexes
BridgeMigrationSchema.index({ fromChain: 1, toChain: 1 });
BridgeMigrationSchema.index({ wallet: 1, createdAt: -1 });
BridgeMigrationSchema.index({ sourceEventIds: 1 });

export const BridgeMigrationModel = mongoose.model<IBridgeMigration>(
  'BridgeMigration',
  BridgeMigrationSchema
);

// ============================================================================
// REPOSITORY FUNCTIONS
// ============================================================================

/**
 * Check if migration already exists for given source events
 */
export async function migrationExistsForEvents(eventIds: string[]): Promise<boolean> {
  const sortedIds = [...eventIds].sort();
  const existing = await BridgeMigrationModel.findOne({
    sourceEventIds: { $all: sortedIds },
  });
  return !!existing;
}

/**
 * Get recent migrations
 */
export async function getRecentMigrations(
  limit = 50,
  filters?: {
    fromChain?: string;
    toChain?: string;
    wallet?: string;
    minConfidence?: number;
  }
): Promise<IBridgeMigration[]> {
  const query: any = {};
  
  if (filters?.fromChain) query.fromChain = filters.fromChain;
  if (filters?.toChain) query.toChain = filters.toChain;
  if (filters?.wallet) query.wallet = filters.wallet;
  if (filters?.minConfidence) query.confidence = { $gte: filters.minConfidence };
  
  return BridgeMigrationModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit);
}

/**
 * Get migration by ID
 */
export async function getMigrationById(migrationId: string): Promise<IBridgeMigration | null> {
  return BridgeMigrationModel.findOne({ migrationId });
}
