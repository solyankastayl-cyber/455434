/**
 * Relations MongoDB Model (L3 - Aggregated Layer)
 * 
 * Built FROM transfers (L2)
 * Used BY graphs, influence, signals, bundles
 * 
 * Key concept:
 * "Between A and B over window T there are N interactions
 *  with total volume V, direction, and DENSITY"
 * 
 * 1000 transfers → 1 relation with density score
 * This is how we solve the "onion problem" (Warhammer-style)
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Time window for aggregation
 */
export type RelationWindow = '1d' | '7d' | '30d' | '90d' | 'all';

/**
 * Direction of the relation
 */
export type RelationDirection = 'out' | 'in' | 'bi';

/**
 * Source of the relation data
 */
export type RelationSource = 'erc20' | 'eth' | 'all';

/**
 * Chain
 */
export type RelationChain = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'polygon';

/**
 * Relation Document Interface
 */
export interface IRelation extends Document {
  _id: Types.ObjectId;
  
  // Participants (addresses)
  from: string;
  to: string;
  
  // Chain
  chain: RelationChain;
  
  // Time window
  window: RelationWindow;
  
  // Direction
  direction: RelationDirection;
  
  // Aggregated metrics
  interactionCount: number;  // Number of transfers
  volumeRaw: string;         // Sum of amountRaw (BigInt as string)
  
  // Time bounds
  firstSeenAt: Date;
  lastSeenAt: Date;
  
  // ========== KEY METRIC ==========
  // densityScore = log(interactionCount + 1) * log(volumeRaw + 1) / windowDays
  // This is what makes corridors "thick" not "wide"
  densityScore: number;
  
  // Source tracking
  source: RelationSource;
  
  // Processing metadata
  lastTransferProcessed: string | null;  // Last transfer _id processed
  processedAt: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Relation Schema
 */
const RelationSchema = new Schema<IRelation>(
  {
    // Participants
    from: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    to: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    
    // Chain
    chain: {
      type: String,
      enum: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'],
      required: true,
      default: 'ethereum',
    },
    
    // Time window
    window: {
      type: String,
      enum: ['1d', '7d', '30d', '90d', 'all'],
      required: true,
      index: true,
    },
    
    // Direction
    direction: {
      type: String,
      enum: ['out', 'in', 'bi'],
      required: true,
    },
    
    // Aggregated metrics
    interactionCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    volumeRaw: {
      type: String,
      required: true,
      default: '0',
    },
    
    // Time bounds
    firstSeenAt: {
      type: Date,
      required: true,
    },
    lastSeenAt: {
      type: Date,
      required: true,
      index: true,
    },
    
    // KEY METRIC
    densityScore: {
      type: Number,
      required: true,
      default: 0,
      index: true,
    },
    
    // Source
    source: {
      type: String,
      enum: ['erc20', 'eth', 'all'],
      required: true,
      default: 'erc20',
    },
    
    // Processing metadata
    lastTransferProcessed: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'relations',
  }
);

// ========== INDEXES ==========

// Unique relation per pair + window
RelationSchema.index(
  { from: 1, to: 1, window: 1, chain: 1 },
  { unique: true }
);

// For graph queries (hottest corridors)
RelationSchema.index({ window: 1, densityScore: -1 });
RelationSchema.index({ densityScore: -1 });

// For address queries
RelationSchema.index({ from: 1, window: 1, densityScore: -1 });
RelationSchema.index({ to: 1, window: 1, densityScore: -1 });

// For corridor lookup
RelationSchema.index({ from: 1, to: 1, window: 1 });

// For time-based queries
RelationSchema.index({ lastSeenAt: -1 });

export const RelationModel = mongoose.model<IRelation>('Relation', RelationSchema);

/**
 * Window to days mapping
 */
export const WINDOW_DAYS: Record<RelationWindow, number> = {
  '1d': 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  'all': 365, // Use 365 as approximation for "all time"
};

/**
 * Calculate density score
 * 
 * Formula: log(interactionCount + 1) * log(volumeRaw + 1) / windowDays
 * 
 * This ensures:
 * - Score doesn't explode with volume
 * - More interactions = higher density
 * - Longer windows dilute the score
 * - Line becomes thicker, not wider
 */
export function calculateDensityScore(
  interactionCount: number,
  volumeRaw: string,
  window: RelationWindow
): number {
  const windowDays = WINDOW_DAYS[window];
  
  // Parse volumeRaw safely
  let volumeNum: number;
  try {
    // For very large numbers, use log of string length as approximation
    if (volumeRaw.length > 15) {
      volumeNum = Math.pow(10, volumeRaw.length - 1);
    } else {
      volumeNum = Number(volumeRaw);
    }
  } catch {
    volumeNum = 0;
  }
  
  // Calculate density
  const density = 
    (Math.log(interactionCount + 1) * Math.log(volumeNum + 1)) / windowDays;
  
  // Round to 4 decimal places
  return Math.round(density * 10000) / 10000;
}
