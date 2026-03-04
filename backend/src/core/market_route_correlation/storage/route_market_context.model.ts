/**
 * Route Market Context Model (P1.6)
 * 
 * Stores market context snapshots associated with routes.
 * Links route intelligence with market conditions.
 */

import mongoose, { Schema, Document, Model } from 'mongoose';

// ============================================
// Types
// ============================================

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH';
export type LiquidityRegime = 'THIN' | 'NORMAL' | 'DEEP';

export interface IMarketSnapshot {
  priceChange24h: number;
  volumeUsd24h: number;
  volumeDeltaZscore: number;
  volatilityRegime: VolatilityRegime;
  liquidityRegime: LiquidityRegime;
  isStressed: boolean;
  dataQuality: number;
}

export interface IRouteMarketContext {
  routeId: string;
  token: string;
  timeWindow: {
    from: number;
    to: number;
  };
  marketSnapshot: IMarketSnapshot | null;
  sourceQuality: number;
  resolvedAt: number;
  
  // Contextual risk output
  contextualRisk?: {
    baseDumpRiskScore: number;
    contextualDumpRiskScore: number;
    marketAmplifier: number;
    contextTags: string[];
    confidenceImpact: number;
  };
  
  createdAt: number;
  updatedAt: number;
}

export interface IRouteMarketContextDocument extends IRouteMarketContext, Document {
  _id: mongoose.Types.ObjectId;
}

// ============================================
// Schema
// ============================================

const MarketSnapshotSchema = new Schema({
  priceChange24h: { type: Number, required: true },
  volumeUsd24h: { type: Number, required: true },
  volumeDeltaZscore: { type: Number, required: true },
  volatilityRegime: { type: String, enum: ['LOW', 'NORMAL', 'HIGH'], required: true },
  liquidityRegime: { type: String, enum: ['THIN', 'NORMAL', 'DEEP'], required: true },
  isStressed: { type: Boolean, required: true },
  dataQuality: { type: Number, required: true }
}, { _id: false });

const ContextualRiskSchema = new Schema({
  baseDumpRiskScore: { type: Number, required: true },
  contextualDumpRiskScore: { type: Number, required: true },
  marketAmplifier: { type: Number, required: true },
  contextTags: { type: [String], default: [] },
  confidenceImpact: { type: Number, required: true }
}, { _id: false });

const RouteMarketContextSchema = new Schema<IRouteMarketContextDocument>({
  routeId: { type: String, required: true, index: true },
  token: { type: String, required: true, index: true, uppercase: true },
  
  timeWindow: {
    from: { type: Number, required: true },
    to: { type: Number, required: true }
  },
  
  marketSnapshot: { type: MarketSnapshotSchema, default: null },
  sourceQuality: { type: Number, required: true, default: 0 },
  resolvedAt: { type: Number, required: true },
  
  contextualRisk: { type: ContextualRiskSchema, default: null },
  
  createdAt: { type: Number, required: true },
  updatedAt: { type: Number, required: true }
}, {
  collection: 'route_market_contexts'
});

// Indexes
RouteMarketContextSchema.index({ routeId: 1 }, { unique: true });
RouteMarketContextSchema.index({ token: 1, resolvedAt: -1 });
RouteMarketContextSchema.index({ 'contextualRisk.contextualDumpRiskScore': -1 });
RouteMarketContextSchema.index({ createdAt: -1 });

// ============================================
// Model
// ============================================

export const RouteMarketContextModel: Model<IRouteMarketContextDocument> =
  mongoose.models.RouteMarketContext ||
  mongoose.model<IRouteMarketContextDocument>('RouteMarketContext', RouteMarketContextSchema);

// ============================================
// CRUD Helpers
// ============================================

export async function getContextByRouteId(routeId: string): Promise<IRouteMarketContextDocument | null> {
  return RouteMarketContextModel.findOne({ routeId });
}

export async function getHighRiskContexts(
  minRiskScore: number = 70,
  limit: number = 100
): Promise<IRouteMarketContextDocument[]> {
  return RouteMarketContextModel.find({
    'contextualRisk.contextualDumpRiskScore': { $gte: minRiskScore }
  })
    .sort({ 'contextualRisk.contextualDumpRiskScore': -1 })
    .limit(limit);
}

export async function getRecentContexts(
  token?: string,
  limit: number = 50
): Promise<IRouteMarketContextDocument[]> {
  const query: any = {};
  if (token) query.token = token.toUpperCase();
  
  return RouteMarketContextModel.find(query)
    .sort({ resolvedAt: -1 })
    .limit(limit);
}
