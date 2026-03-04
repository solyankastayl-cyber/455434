/**
 * Actor Cluster Model (P2.2)
 * 
 * Clusters wallets into strategic actors using deterministic heuristics
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export interface ClusterHeuristic {
  type: 'funding' | 'bridge_route' | 'time_correlation' | 'counterparty';
  weight: number;
  score: number;
  evidence: {
    shared?: string[];
    patterns?: string[];
    timestamps?: number[];
    count?: number;
  };
}

export interface ClusterMember {
  address: string;
  chain: string;
  addedAt: Date;
  confidence: number;
  role?: 'primary' | 'secondary';
}

export interface ClusterMetrics {
  totalValue: number;
  transactionCount: number;
  bridgeCount: number;
  chains: string[];
  firstSeen: Date;
  lastSeen: Date;
}

// ============================================
// Actor Cluster Document
// ============================================

export interface IActorClusterDocument extends Document {
  clusterId: string;
  name?: string;
  
  // Members
  wallets: ClusterMember[];
  primaryAddress: string;
  
  // Confidence scoring
  confidenceScore: number;
  heuristics: ClusterHeuristic[];
  
  // Metrics
  metrics: ClusterMetrics;
  
  // Audit trail
  version: number;
  history: {
    action: 'created' | 'merged' | 'split' | 'updated';
    timestamp: Date;
    walletsAdded?: string[];
    walletsRemoved?: string[];
  }[];
  
  createdAt: Date;
  updatedAt: Date;
}

const ClusterHeuristicSchema = new Schema({
  type: { 
    type: String, 
    enum: ['funding', 'bridge_route', 'time_correlation', 'counterparty'],
    required: true 
  },
  weight: { type: Number, required: true },
  score: { type: Number, required: true },
  evidence: {
    shared: [String],
    patterns: [String],
    timestamps: [Number],
    count: Number,
  },
}, { _id: false });

const ClusterMemberSchema = new Schema({
  address: { type: String, required: true },
  chain: { type: String, required: true },
  addedAt: { type: Date, default: Date.now },
  confidence: { type: Number, default: 0 },
  role: { type: String, enum: ['primary', 'secondary'] },
}, { _id: false });

const ClusterMetricsSchema = new Schema({
  totalValue: { type: Number, default: 0 },
  transactionCount: { type: Number, default: 0 },
  bridgeCount: { type: Number, default: 0 },
  chains: [String],
  firstSeen: { type: Date },
  lastSeen: { type: Date },
}, { _id: false });

const ClusterHistorySchema = new Schema({
  action: { 
    type: String, 
    enum: ['created', 'merged', 'split', 'updated'],
    required: true 
  },
  timestamp: { type: Date, default: Date.now },
  walletsAdded: [String],
  walletsRemoved: [String],
}, { _id: false });

const ActorClusterSchema = new Schema<IActorClusterDocument>({
  clusterId: { type: String, required: true, unique: true, index: true },
  name: { type: String },
  
  wallets: [ClusterMemberSchema],
  primaryAddress: { type: String, required: true, index: true },
  
  confidenceScore: { type: Number, required: true, min: 0, max: 1 },
  heuristics: [ClusterHeuristicSchema],
  
  metrics: ClusterMetricsSchema,
  
  version: { type: Number, default: 1 },
  history: [ClusterHistorySchema],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Indexes
ActorClusterSchema.index({ 'wallets.address': 1 });
ActorClusterSchema.index({ 'wallets.chain': 1 });
ActorClusterSchema.index({ confidenceScore: -1 });
ActorClusterSchema.index({ 'metrics.chains': 1 });
ActorClusterSchema.index({ updatedAt: -1 });

export const ActorClusterModel = mongoose.model<IActorClusterDocument>('actor_clusters', ActorClusterSchema);

// ============================================
// Wallet-Cluster Link Document (for fast lookup)
// ============================================

export interface IWalletClusterLink extends Document {
  address: string;
  chain: string;
  clusterId: string;
  confidence: number;
  addedAt: Date;
}

const WalletClusterLinkSchema = new Schema<IWalletClusterLink>({
  address: { type: String, required: true, index: true },
  chain: { type: String, required: true, index: true },
  clusterId: { type: String, required: true, index: true },
  confidence: { type: Number, required: true },
  addedAt: { type: Date, default: Date.now },
});

// Compound index for fast lookup
WalletClusterLinkSchema.index({ address: 1, chain: 1 }, { unique: true });

export const WalletClusterLinkModel = mongoose.model<IWalletClusterLink>('actor_wallet_links', WalletClusterLinkSchema);

// ============================================
// Helper Functions
// ============================================

/**
 * Find cluster by wallet address
 */
export async function findClusterByWallet(address: string, chain: string): Promise<IActorClusterDocument | null> {
  const link = await WalletClusterLinkModel.findOne({ 
    address: address.toLowerCase(), 
    chain 
  }).lean();
  
  if (!link) return null;
  
  return ActorClusterModel.findOne({ clusterId: link.clusterId }).lean();
}

/**
 * Get all wallets in a cluster
 */
export async function getClusterWallets(clusterId: string): Promise<ClusterMember[]> {
  const cluster = await ActorClusterModel.findOne({ clusterId }).lean();
  return cluster?.wallets || [];
}

/**
 * Check if wallet is already in a cluster
 */
export async function isWalletClustered(address: string, chain: string): Promise<boolean> {
  const link = await WalletClusterLinkModel.findOne({ 
    address: address.toLowerCase(), 
    chain 
  });
  return !!link;
}
