/**
 * Bundles MongoDB Model (L4 - Intelligence Layer)
 * 
 * Built FROM relations (L3)
 * Provides INTERPRETATION of capital flows
 * 
 * Key concept:
 * - relation = road (topology)
 * - bundle = traffic on the road (behavior)
 * 
 * Bundle types:
 * - accumulation: many incoming, few outgoing
 * - distribution: many outgoing, few incoming
 * - flow: balanced bidirectional
 * - wash: symmetric volume, short lag (suspicious)
 * - rotation: cyclic patterns
 */
import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Bundle types - behavioral classification
 */
export type BundleType = 
  | 'accumulation'   // Buying/collecting
  | 'distribution'   // Selling/dispersing
  | 'flow'           // Balanced movement
  | 'wash'           // Suspicious wash trading
  | 'rotation'       // Cyclic movement
  | 'unknown';       // Insufficient data

/**
 * Time window (same as relations)
 */
export type BundleWindow = '1d' | '7d' | '30d';

/**
 * Chain
 */
export type BundleChain = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'polygon';

/**
 * Bundle Document Interface
 */
export interface IBundle extends Document {
  _id: Types.ObjectId;
  
  // Corridor identification
  from: string;
  to: string;
  chain: BundleChain;
  window: BundleWindow;
  
  // Classification
  bundleType: BundleType;
  confidence: number;  // 0-1, how confident is the classification
  
  // Metrics from relations
  interactionCount: number;
  densityScore: number;
  
  // Netflow analysis
  netflowRaw: string;         // in - out (BigInt as string)
  netflowDirection: 'in' | 'out' | 'balanced';
  
  // Intensity: combines density + netflow magnitude
  intensityScore: number;
  
  // Consistency: how regular is the activity
  consistencyScore: number;
  
  // Time bounds
  firstSeenAt: Date;
  lastSeenAt: Date;
  
  // Source relations used
  sourceRelationIds: string[];
  
  // Processing metadata
  processedAt: Date;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Bundle Schema
 */
const BundleSchema = new Schema<IBundle>(
  {
    // Corridor identification
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
    chain: {
      type: String,
      enum: ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon'],
      required: true,
      default: 'ethereum',
    },
    window: {
      type: String,
      enum: ['1d', '7d', '30d'],
      required: true,
      index: true,
    },
    
    // Classification
    bundleType: {
      type: String,
      enum: ['accumulation', 'distribution', 'flow', 'wash', 'rotation', 'unknown'],
      required: true,
      index: true,
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
      default: 0,
    },
    
    // Metrics
    interactionCount: {
      type: Number,
      required: true,
      default: 0,
    },
    densityScore: {
      type: Number,
      required: true,
      default: 0,
    },
    
    // Netflow
    netflowRaw: {
      type: String,
      required: true,
      default: '0',
    },
    netflowDirection: {
      type: String,
      enum: ['in', 'out', 'balanced'],
      required: true,
    },
    
    // Scores
    intensityScore: {
      type: Number,
      required: true,
      default: 0,
      index: true,
    },
    consistencyScore: {
      type: Number,
      required: true,
      default: 0,
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
    
    // Source tracking
    sourceRelationIds: {
      type: [String],
      default: [],
    },
    
    // Processing
    processedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'bundles',
  }
);

// ========== INDEXES ==========

// Unique bundle per corridor + window
BundleSchema.index(
  { from: 1, to: 1, window: 1, chain: 1 },
  { unique: true }
);

// For type-based queries
BundleSchema.index({ bundleType: 1, window: 1, intensityScore: -1 });

// For address queries
BundleSchema.index({ from: 1, window: 1, bundleType: 1 });
BundleSchema.index({ to: 1, window: 1, bundleType: 1 });

// For intensity ranking
BundleSchema.index({ intensityScore: -1 });
BundleSchema.index({ window: 1, intensityScore: -1 });

// For confidence filtering
BundleSchema.index({ confidence: -1 });

export const BundleModel = mongoose.model<IBundle>('Bundle', BundleSchema);

/**
 * Calculate intensity score
 * Combines density with netflow magnitude
 */
export function calculateIntensityScore(
  densityScore: number,
  netflowRaw: string
): number {
  // Parse netflow magnitude (absolute value)
  let netflowMagnitude: number;
  try {
    const netflow = BigInt(netflowRaw);
    const absNetflow = netflow < 0n ? -netflow : netflow;
    // Normalize to reasonable scale
    if (absNetflow.toString().length > 15) {
      netflowMagnitude = Math.pow(10, absNetflow.toString().length - 10);
    } else {
      netflowMagnitude = Number(absNetflow) / 1e10; // Normalize
    }
  } catch {
    netflowMagnitude = 0;
  }
  
  // Intensity = density * (1 + log(netflow + 1))
  const intensity = densityScore * (1 + Math.log(netflowMagnitude + 1));
  
  return Math.round(intensity * 10000) / 10000;
}

/**
 * Determine netflow direction
 */
export function getNetflowDirection(netflowRaw: string): 'in' | 'out' | 'balanced' {
  try {
    const netflow = BigInt(netflowRaw);
    const threshold = BigInt(1e15); // Minimum significant netflow
    
    if (netflow > threshold) return 'in';
    if (netflow < -threshold) return 'out';
    return 'balanced';
  } catch {
    return 'balanced';
  }
}
