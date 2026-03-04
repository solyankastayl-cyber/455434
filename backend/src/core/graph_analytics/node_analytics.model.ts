/**
 * Node Analytics Model - ETAP D2
 * 
 * Pre-calculated analytics for each address.
 * Updated by cron job, NOT calculated on the fly.
 * 
 * This is the SOURCE OF TRUTH for node metrics.
 */

import { mongoose } from '../../db/mongoose.js';

const NodeAnalyticsSchema = new mongoose.Schema({
  // Identity
  address: { type: String, required: true, lowercase: true },
  network: { type: String, required: true, lowercase: true },
  
  // Volumes (USD)
  inVolumeUsd: { type: Number, default: 0 },
  outVolumeUsd: { type: Number, default: 0 },
  totalVolumeUsd: { type: Number, default: 0 },
  netFlowUsd: { type: Number, default: 0 }, // out - in (positive = net sender)
  
  // Activity counts
  inTxCount: { type: Number, default: 0 },
  outTxCount: { type: Number, default: 0 },
  txCount: { type: Number, default: 0 },
  
  // Topology (degree)
  uniqueInDegree: { type: Number, default: 0 },  // unique senders
  uniqueOutDegree: { type: Number, default: 0 }, // unique receivers
  hubScore: { type: Number, default: 0 },        // in + out degree
  
  // Time
  firstSeen: { type: Date },
  lastSeen: { type: Date },
  recencyScore: { type: Number, default: 0 },    // 0-1, higher = more recent
  
  // Final scores
  influenceScore: { type: Number, default: 0 },  // 0-1, for node size
  activityScore: { type: Number, default: 0 },   // 0-1, for activity level
  
  // Entity info (if known)
  entityType: { type: String },  // CEX, DEX, BRIDGE, WALLET
  entityName: { type: String },  // Binance, Uniswap, etc.
  tags: [{ type: String }],
  
  // Meta
  updatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },
}, {
  collection: 'node_analytics',
  timestamps: { createdAt: 'createdAt', updatedAt: false },
});

// Compound unique index
NodeAnalyticsSchema.index({ address: 1, network: 1 }, { unique: true });

// Query indexes
NodeAnalyticsSchema.index({ network: 1, influenceScore: -1 });
NodeAnalyticsSchema.index({ network: 1, totalVolumeUsd: -1 });
NodeAnalyticsSchema.index({ network: 1, hubScore: -1 });
NodeAnalyticsSchema.index({ updatedAt: 1 });

export const NodeAnalyticsModel = mongoose.model('NodeAnalytics', NodeAnalyticsSchema);

/**
 * Get node analytics by address
 */
export async function getNodeAnalytics(address: string, network: string) {
  return NodeAnalyticsModel.findOne({ 
    address: address.toLowerCase(), 
    network: network.toLowerCase() 
  }).lean();
}

/**
 * Get analytics for multiple addresses
 */
export async function getNodeAnalyticsBatch(addresses: string[], network: string) {
  const lowercaseAddresses = addresses.map(a => a.toLowerCase());
  return NodeAnalyticsModel.find({
    address: { $in: lowercaseAddresses },
    network: network.toLowerCase(),
  }).lean();
}

/**
 * Upsert node analytics
 */
export async function upsertNodeAnalytics(analytics: {
  address: string;
  network: string;
  [key: string]: any;
}) {
  return NodeAnalyticsModel.updateOne(
    { address: analytics.address.toLowerCase(), network: analytics.network.toLowerCase() },
    { $set: { ...analytics, updatedAt: new Date() } },
    { upsert: true }
  );
}

/**
 * Get top nodes by influence
 */
export async function getTopNodesByInfluence(network: string, limit = 100) {
  return NodeAnalyticsModel.find({ network: network.toLowerCase() })
    .sort({ influenceScore: -1 })
    .limit(limit)
    .lean();
}
