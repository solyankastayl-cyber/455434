/**
 * Shadow Feature Store
 * 
 * EPIC 7: Stores temporal features for audit and future training
 * 
 * Features are stored in SHADOW mode only:
 * - No impact on decisions
 * - Available for offline analysis
 * - Retained 30-60 days
 */

import mongoose, { Schema, Document } from 'mongoose';
import type { TemporalSample, TemporalFeatureVector, MetricTemporalFeatures } from './temporal.types.js';

export interface IShadowFeature extends Document {
  sampleId: string;
  tokenAddress: string;
  signalId?: string;
  
  // Raw temporal features
  metrics: Partial<MetricTemporalFeatures>;
  
  // Flattened vector
  featureVector: TemporalFeatureVector;
  
  // Metadata
  gateVersion: string;
  sourceVersion: string;
  
  createdAt: Date;
  expiresAt: Date;
}

const ShadowFeatureSchema = new Schema<IShadowFeature>({
  sampleId: { type: String, required: true, unique: true },
  tokenAddress: { type: String, required: true, index: true },
  signalId: { type: String, index: true },
  
  metrics: { type: Schema.Types.Mixed, default: {} },
  featureVector: { type: Schema.Types.Mixed, default: {} },
  
  gateVersion: { type: String, required: true },
  sourceVersion: { type: String, required: true },
  
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, required: true, index: true },
});

// TTL index for automatic cleanup (expires after expiresAt)
ShadowFeatureSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for queries
ShadowFeatureSchema.index({ tokenAddress: 1, createdAt: -1 });
ShadowFeatureSchema.index({ gateVersion: 1, createdAt: -1 });

export const ShadowFeatureModel = mongoose.model<IShadowFeature>('shadow_features', ShadowFeatureSchema);

// Default retention period: 45 days
const DEFAULT_RETENTION_DAYS = 45;

/**
 * Store temporal features in shadow store
 */
export async function storeShadowFeature(sample: TemporalSample): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_RETENTION_DAYS);
  
  const doc = await ShadowFeatureModel.create({
    sampleId: sample.sampleId,
    tokenAddress: sample.tokenAddress,
    signalId: sample.signalId,
    metrics: sample.metrics,
    featureVector: sample.featureVector,
    gateVersion: sample.gateVersion,
    sourceVersion: sample.sourceVersion,
    createdAt: sample.createdAt,
    expiresAt,
  });
  
  return doc.sampleId;
}

/**
 * Get shadow features for a token
 */
export async function getShadowFeatures(
  tokenAddress: string,
  limit: number = 100
): Promise<IShadowFeature[]> {
  return ShadowFeatureModel.find({ tokenAddress })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get shadow features by signal
 */
export async function getShadowFeatureBySignal(signalId: string): Promise<IShadowFeature | null> {
  return ShadowFeatureModel.findOne({ signalId }).lean();
}

/**
 * Get recent shadow features for analysis
 */
export async function getRecentShadowFeatures(
  hours: number = 24,
  limit: number = 1000
): Promise<IShadowFeature[]> {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - hours);
  
  return ShadowFeatureModel.find({ createdAt: { $gte: cutoff } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Count shadow features by gate version
 */
export async function countByGateVersion(): Promise<Record<string, number>> {
  const result = await ShadowFeatureModel.aggregate([
    { $group: { _id: '$gateVersion', count: { $sum: 1 } } }
  ]);
  
  return result.reduce((acc, r) => {
    acc[r._id] = r.count;
    return acc;
  }, {} as Record<string, number>);
}

/**
 * Get feature statistics for monitoring
 */
export async function getShadowStats(): Promise<{
  totalCount: number;
  last24h: number;
  last7d: number;
  byGateVersion: Record<string, number>;
}> {
  const now = new Date();
  const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const [totalCount, last24h, last7d, byGateVersion] = await Promise.all([
    ShadowFeatureModel.countDocuments(),
    ShadowFeatureModel.countDocuments({ createdAt: { $gte: h24 } }),
    ShadowFeatureModel.countDocuments({ createdAt: { $gte: d7 } }),
    countByGateVersion(),
  ]);
  
  return { totalCount, last24h, last7d, byGateVersion };
}
