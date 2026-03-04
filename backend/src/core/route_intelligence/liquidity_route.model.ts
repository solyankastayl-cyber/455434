/**
 * Liquidity Route Model (P0.3)
 * 
 * A route represents a connected sequence of on-chain events
 * belonging to a single liquidity movement intention.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type RouteType = 
  | 'EXIT'          // Ends at CEX - potential sell
  | 'MIGRATION'     // Multi-chain, no exit
  | 'MIXING'        // Zig-zag + routers - obfuscation
  | 'INTERNAL'      // Same chain movements
  | 'UNKNOWN';      // Cannot classify

export type RouteStatus = 
  | 'ACTIVE'        // Still building
  | 'COMPLETE'      // Route finished
  | 'STALE';        // No activity, timeout

export interface ILiquidityRoute {
  routeId: string;
  
  // Actor link
  actorId?: string;         // Link to actor cluster
  
  // Route endpoints
  startWallet: string;
  endWallet?: string;
  
  // Chain info
  startChain: string;
  endChain?: string;
  chainsInvolved: string[];  // All chains touched
  
  // Classification
  routeType: RouteType;
  status: RouteStatus;
  
  // Labels (from P0.2)
  startLabel?: string;       // Label of start wallet
  endLabel?: string;         // "Binance", "Coinbase", "Unknown"
  
  // Metrics
  segmentsCount: number;
  bridgesCount: number;
  swapsCount: number;
  
  // Value
  totalAmountUsd?: number;
  primaryToken?: string;     // Main token in route
  
  // Confidence
  confidenceScore: number;   // 0-1
  confidenceFactors: {
    amountSimilarity: number;
    timeProximity: number;
    bridgeMatch: number;
    protocolKnown: number;
    cexMatch: number;
  };
  
  // Timestamps
  firstSeenAt: Date;
  lastSeenAt: Date;
  durationMs: number;        // Total route duration
  
  // Audit
  createdAt: Date;
  updatedAt: Date;
}

export interface ILiquidityRouteDocument extends ILiquidityRoute, Document {}

// ============================================
// Schema
// ============================================

const ConfidenceFactorsSchema = new Schema({
  amountSimilarity: { type: Number, default: 0 },
  timeProximity: { type: Number, default: 0 },
  bridgeMatch: { type: Number, default: 0 },
  protocolKnown: { type: Number, default: 0 },
  cexMatch: { type: Number, default: 0 }
}, { _id: false });

const LiquidityRouteSchema = new Schema<ILiquidityRouteDocument>({
  routeId: { type: String, required: true, unique: true, index: true },
  
  actorId: { type: String, index: true },
  
  startWallet: { type: String, required: true, lowercase: true, index: true },
  endWallet: { type: String, lowercase: true },
  
  startChain: { type: String, required: true },
  endChain: { type: String },
  chainsInvolved: [{ type: String }],
  
  routeType: { 
    type: String, 
    enum: ['EXIT', 'MIGRATION', 'MIXING', 'INTERNAL', 'UNKNOWN'],
    default: 'UNKNOWN',
    index: true
  },
  status: { 
    type: String, 
    enum: ['ACTIVE', 'COMPLETE', 'STALE'],
    default: 'ACTIVE',
    index: true
  },
  
  startLabel: { type: String },
  endLabel: { type: String, index: true },
  
  segmentsCount: { type: Number, default: 0 },
  bridgesCount: { type: Number, default: 0 },
  swapsCount: { type: Number, default: 0 },
  
  totalAmountUsd: { type: Number },
  primaryToken: { type: String },
  
  confidenceScore: { type: Number, default: 0 },
  confidenceFactors: { type: ConfidenceFactorsSchema, default: {} },
  
  firstSeenAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  durationMs: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes
LiquidityRouteSchema.index({ routeType: 1, endLabel: 1 });
LiquidityRouteSchema.index({ startWallet: 1, firstSeenAt: -1 });
LiquidityRouteSchema.index({ actorId: 1, routeType: 1 });
LiquidityRouteSchema.index({ confidenceScore: -1 });
LiquidityRouteSchema.index({ lastSeenAt: -1 });

// Update timestamp on save
LiquidityRouteSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

export const LiquidityRouteModel = mongoose.model<ILiquidityRouteDocument>(
  'liquidity_route',
  LiquidityRouteSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate route ID
 */
export function generateRouteId(startWallet: string, timestamp: Date): string {
  return `ROUTE:${startWallet.toLowerCase().slice(0, 10)}:${timestamp.getTime()}:${Math.random().toString(36).substr(2, 6)}`;
}
