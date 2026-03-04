/**
 * Route Enriched Model (P0.5)
 * 
 * Enriched routes with SWAP segments, risk scoring, and confidence.
 * Separate from P0.3 liquidity_routes for versioning and comparison.
 */

import mongoose, { Schema, Document } from 'mongoose';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export type SegmentTypeV2 = 
  | 'TRANSFER' 
  | 'BRIDGE' 
  | 'SWAP' 
  | 'CEX_DEPOSIT' 
  | 'CEX_WITHDRAW' 
  | 'CONTRACT';

export type RouteTypeV2 = 
  | 'EXIT'       // Ends at CEX
  | 'MIGRATION'  // Cross-chain, no CEX
  | 'MIXING'     // High entropy, obfuscation
  | 'INTERNAL'   // Same chain movements
  | 'ACCUMULATION' // Into wallet from multiple sources
  | 'UNKNOWN';

export interface ISegmentV2 {
  index: number;
  type: SegmentTypeV2;
  chainFrom: string;
  chainTo?: string;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
  walletFrom: string;
  walletTo: string;
  tokenAddress: string;
  tokenSymbol?: string;
  amount: string;
  amountUsd?: number;
  
  // Labels
  fromLabel?: string;
  toLabel?: string;
  
  // Protocol info (for SWAP/BRIDGE)
  protocol?: string;
  protocolType?: string;
  
  // DEX-specific (for SWAP)
  dex?: string;
  poolAddress?: string;
  tokenIn?: string;
  tokenOut?: string;
  tokenInSymbol?: string;
  tokenOutSymbol?: string;
  
  // Confidence for this segment
  confidence: number;
}

export interface IRiskScores {
  exitProbability: number;      // 0..1
  dumpRiskScore: number;        // 0..100
  pathEntropy: number;          // 0..1
}

export interface IRouteLabels {
  cexTouched: boolean;
  bridgeTouched: boolean;
  mixerSuspected: boolean;
  cexNames?: string[];
  bridgeProtocols?: string[];
}

export interface IRouteEnriched {
  routeId: string;
  wallet: string;
  
  // Time window
  timeWindowStart: Date;
  timeWindowEnd: Date;
  
  // Route classification
  routeType: RouteTypeV2;
  
  // Chains involved
  chains: string[];
  startChain: string;
  endChain: string;
  
  // Segments
  segments: ISegmentV2[];
  segmentsCount: number;
  swapsCount: number;
  bridgesCount: number;
  
  // Risk scores
  risk: IRiskScores;
  
  // Route confidence (data quality)
  confidence: number;
  
  // Labels
  labels: IRouteLabels;
  
  // Endpoints
  startWallet: string;
  endWallet: string;
  startLabel?: string;
  endLabel?: string;
  
  // Value
  totalAmountUsd?: number;
  primaryToken?: string;
  
  // Metadata
  version: number;
  createdAt: Date;
  updatedAt: Date;
  
  // Alert status
  alertGenerated: boolean;
  alertId?: string;
}

export interface IRouteEnrichedDocument extends IRouteEnriched, Document {}

// ============================================
// Schema
// ============================================

const SegmentV2Schema = new Schema<ISegmentV2>({
  index: { type: Number, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['TRANSFER', 'BRIDGE', 'SWAP', 'CEX_DEPOSIT', 'CEX_WITHDRAW', 'CONTRACT']
  },
  chainFrom: { type: String, required: true },
  chainTo: { type: String },
  txHash: { type: String, required: true },
  blockNumber: { type: Number, required: true },
  timestamp: { type: Date, required: true },
  walletFrom: { type: String, required: true, lowercase: true },
  walletTo: { type: String, required: true, lowercase: true },
  tokenAddress: { type: String, required: true, lowercase: true },
  tokenSymbol: { type: String },
  amount: { type: String, required: true },
  amountUsd: { type: Number },
  fromLabel: { type: String },
  toLabel: { type: String },
  protocol: { type: String },
  protocolType: { type: String },
  dex: { type: String },
  poolAddress: { type: String, lowercase: true },
  tokenIn: { type: String, lowercase: true },
  tokenOut: { type: String, lowercase: true },
  tokenInSymbol: { type: String },
  tokenOutSymbol: { type: String },
  confidence: { type: Number, default: 0.5 }
}, { _id: false });

const RiskScoresSchema = new Schema<IRiskScores>({
  exitProbability: { type: Number, default: 0 },
  dumpRiskScore: { type: Number, default: 0 },
  pathEntropy: { type: Number, default: 0 }
}, { _id: false });

const RouteLabelsSchema = new Schema<IRouteLabels>({
  cexTouched: { type: Boolean, default: false },
  bridgeTouched: { type: Boolean, default: false },
  mixerSuspected: { type: Boolean, default: false },
  cexNames: [{ type: String }],
  bridgeProtocols: [{ type: String }]
}, { _id: false });

const RouteEnrichedSchema = new Schema<IRouteEnrichedDocument>({
  routeId: { type: String, required: true, unique: true, index: true },
  wallet: { type: String, required: true, lowercase: true, index: true },
  
  timeWindowStart: { type: Date, required: true },
  timeWindowEnd: { type: Date, required: true },
  
  routeType: { 
    type: String, 
    required: true,
    enum: ['EXIT', 'MIGRATION', 'MIXING', 'INTERNAL', 'ACCUMULATION', 'UNKNOWN'],
    index: true
  },
  
  chains: [{ type: String }],
  startChain: { type: String, required: true },
  endChain: { type: String, required: true },
  
  segments: [SegmentV2Schema],
  segmentsCount: { type: Number, default: 0 },
  swapsCount: { type: Number, default: 0 },
  bridgesCount: { type: Number, default: 0 },
  
  risk: { type: RiskScoresSchema, default: () => ({}) },
  confidence: { type: Number, default: 0.5, index: true },
  labels: { type: RouteLabelsSchema, default: () => ({}) },
  
  startWallet: { type: String, required: true, lowercase: true },
  endWallet: { type: String, required: true, lowercase: true },
  startLabel: { type: String },
  endLabel: { type: String },
  
  totalAmountUsd: { type: Number },
  primaryToken: { type: String },
  
  version: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  
  alertGenerated: { type: Boolean, default: false },
  alertId: { type: String }
});

// ============================================
// Indexes
// ============================================

// Unique constraint for versioned routes
RouteEnrichedSchema.index(
  { wallet: 1, timeWindowStart: 1, timeWindowEnd: 1, version: 1 },
  { unique: true }
);

// Risk queries
RouteEnrichedSchema.index({ 'risk.dumpRiskScore': -1 });
RouteEnrichedSchema.index({ 'risk.exitProbability': -1 });

// Segment type queries
RouteEnrichedSchema.index({ 'segments.type': 1 });

// Chain queries
RouteEnrichedSchema.index({ chains: 1, updatedAt: -1 });

// Combined queries
RouteEnrichedSchema.index({ routeType: 1, 'risk.dumpRiskScore': -1 });
RouteEnrichedSchema.index({ wallet: 1, createdAt: -1 });

// ============================================
// Model
// ============================================

export const RouteEnrichedModel = mongoose.model<IRouteEnrichedDocument>(
  'routes_enriched',
  RouteEnrichedSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate deterministic route ID
 */
export function generateRouteIdV2(
  wallet: string,
  windowStart: Date,
  windowEnd: Date,
  version: number = 1
): string {
  const data = [
    wallet.toLowerCase(),
    windowStart.toISOString(),
    windowEnd.toISOString(),
    version.toString()
  ].join(':');
  
  return `RV2:${crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)}`;
}

/**
 * Check if route exists
 */
export async function routeExistsV2(routeId: string): Promise<boolean> {
  const count = await RouteEnrichedModel.countDocuments({ routeId });
  return count > 0;
}

/**
 * Get route by ID
 */
export async function getRouteByIdV2(routeId: string): Promise<IRouteEnrichedDocument | null> {
  return RouteEnrichedModel.findOne({ routeId }).lean();
}

/**
 * Get routes by wallet
 */
export async function getRoutesByWalletV2(
  wallet: string,
  options?: {
    limit?: number;
    minRisk?: number;
    routeType?: RouteTypeV2;
  }
): Promise<IRouteEnrichedDocument[]> {
  const query: any = { wallet: wallet.toLowerCase() };
  
  if (options?.minRisk !== undefined) {
    query['risk.dumpRiskScore'] = { $gte: options.minRisk };
  }
  
  if (options?.routeType) {
    query.routeType = options.routeType;
  }
  
  return RouteEnrichedModel.find(query)
    .sort({ createdAt: -1 })
    .limit(options?.limit || 50)
    .lean();
}

/**
 * Get high-risk routes
 */
export async function getHighRiskRoutesV2(
  minRiskScore: number = 80,
  limit: number = 50
): Promise<IRouteEnrichedDocument[]> {
  return RouteEnrichedModel.find({
    'risk.dumpRiskScore': { $gte: minRiskScore }
  })
  .sort({ 'risk.dumpRiskScore': -1 })
  .limit(limit)
  .lean();
}

/**
 * Get exit routes
 */
export async function getExitRoutesV2(
  options?: {
    minProbability?: number;
    since?: Date;
    limit?: number;
  }
): Promise<IRouteEnrichedDocument[]> {
  const query: any = { routeType: 'EXIT' };
  
  if (options?.minProbability !== undefined) {
    query['risk.exitProbability'] = { $gte: options.minProbability };
  }
  
  if (options?.since) {
    query.createdAt = { $gte: options.since };
  }
  
  return RouteEnrichedModel.find(query)
    .sort({ 'risk.exitProbability': -1 })
    .limit(options?.limit || 50)
    .lean();
}

/**
 * Get route statistics
 */
export async function getRouteStatsV2(): Promise<{
  totalRoutes: number;
  byType: Record<string, number>;
  avgRiskScore: number;
  avgExitProbability: number;
  highRiskCount: number;
  exitRoutesToday: number;
}> {
  const [total, typeCounts, avgMetrics, highRisk, exitToday] = await Promise.all([
    RouteEnrichedModel.countDocuments(),
    
    RouteEnrichedModel.aggregate([
      { $group: { _id: '$routeType', count: { $sum: 1 } } }
    ]),
    
    RouteEnrichedModel.aggregate([
      {
        $group: {
          _id: null,
          avgRisk: { $avg: '$risk.dumpRiskScore' },
          avgExit: { $avg: '$risk.exitProbability' }
        }
      }
    ]),
    
    RouteEnrichedModel.countDocuments({ 'risk.dumpRiskScore': { $gte: 80 } }),
    
    RouteEnrichedModel.countDocuments({
      routeType: 'EXIT',
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    })
  ]);
  
  const byType = typeCounts.reduce((acc, t) => {
    acc[t._id] = t.count;
    return acc;
  }, {} as Record<string, number>);
  
  const metrics = avgMetrics[0] || { avgRisk: 0, avgExit: 0 };
  
  return {
    totalRoutes: total,
    byType,
    avgRiskScore: Math.round((metrics.avgRisk || 0) * 10) / 10,
    avgExitProbability: Math.round((metrics.avgExit || 0) * 100) / 100,
    highRiskCount: highRisk,
    exitRoutesToday: exitToday
  };
}
