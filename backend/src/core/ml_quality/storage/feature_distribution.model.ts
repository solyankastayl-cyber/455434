/**
 * Feature Distribution Model (P0.7)
 * 
 * Stores rolling statistics for drift detection.
 * Pre-signals only - no ML decisions.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type DriftAlertLevel = 'INFO' | 'WARN' | 'CRITICAL';

export interface IFeatureDistribution {
  featureKey: string;
  source: string;
  
  // Rolling window stats
  windowStart: Date;
  windowEnd: Date;
  sampleCount: number;
  
  // Distribution metrics
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
  p25: number;
  p75: number;
  
  // Null tracking
  nullCount: number;
  nullRatio: number;
  
  createdAt: Date;
}

export interface IDistributionDelta {
  featureKey: string;
  source: string;
  
  // Comparison window
  baselineWindowStart: Date;
  baselineWindowEnd: Date;
  currentWindowStart: Date;
  currentWindowEnd: Date;
  
  // Delta metrics
  meanDelta: number;
  meanDeltaPct: number;
  stdDelta: number;
  stdDeltaPct: number;
  
  // Z-score of current mean vs baseline
  zscore: number;
  
  // Alert level
  alertLevel: DriftAlertLevel;
  
  // Thresholds that triggered alert
  triggeredThresholds: string[];
  
  timestamp: Date;
  createdAt: Date;
}

export interface IFeatureDistributionDocument extends IFeatureDistribution, Document {}
export interface IDistributionDeltaDocument extends IDistributionDelta, Document {}

// ============================================
// Distribution Schema
// ============================================

const FeatureDistributionSchema = new Schema<IFeatureDistributionDocument>({
  featureKey: { type: String, required: true, index: true },
  source: { type: String, required: true, index: true },
  
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  sampleCount: { type: Number, required: true },
  
  mean: { type: Number, required: true },
  std: { type: Number, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  median: { type: Number, required: true },
  p25: { type: Number, required: true },
  p75: { type: Number, required: true },
  
  nullCount: { type: Number, default: 0 },
  nullRatio: { type: Number, default: 0 },
  
  createdAt: { type: Date, default: Date.now, index: true }
});

FeatureDistributionSchema.index({ featureKey: 1, windowEnd: -1 });
FeatureDistributionSchema.index({ source: 1, windowEnd: -1 });

// ============================================
// Delta Schema
// ============================================

const DistributionDeltaSchema = new Schema<IDistributionDeltaDocument>({
  featureKey: { type: String, required: true, index: true },
  source: { type: String, required: true, index: true },
  
  baselineWindowStart: { type: Date, required: true },
  baselineWindowEnd: { type: Date, required: true },
  currentWindowStart: { type: Date, required: true },
  currentWindowEnd: { type: Date, required: true },
  
  meanDelta: { type: Number, required: true },
  meanDeltaPct: { type: Number, required: true },
  stdDelta: { type: Number, required: true },
  stdDeltaPct: { type: Number, required: true },
  
  zscore: { type: Number, required: true },
  
  alertLevel: { 
    type: String, 
    enum: ['INFO', 'WARN', 'CRITICAL'],
    required: true,
    index: true 
  },
  
  triggeredThresholds: [{ type: String }],
  
  timestamp: { type: Date, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});

DistributionDeltaSchema.index({ alertLevel: 1, timestamp: -1 });
DistributionDeltaSchema.index({ featureKey: 1, timestamp: -1 });

// ============================================
// Models
// ============================================

export const FeatureDistributionModel = mongoose.model<IFeatureDistributionDocument>(
  'ml_feature_distributions',
  FeatureDistributionSchema
);

export const DistributionDeltaModel = mongoose.model<IDistributionDeltaDocument>(
  'ml_distribution_deltas',
  DistributionDeltaSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Save distribution snapshot
 */
export async function saveDistribution(
  dist: Omit<IFeatureDistribution, 'createdAt'>
): Promise<IFeatureDistributionDocument> {
  return FeatureDistributionModel.create({
    ...dist,
    createdAt: new Date()
  });
}

/**
 * Get latest distribution for feature
 */
export async function getLatestDistribution(
  featureKey: string
): Promise<IFeatureDistributionDocument | null> {
  return FeatureDistributionModel.findOne({ featureKey })
    .sort({ windowEnd: -1 })
    .lean();
}

/**
 * Get baseline distribution (older window for comparison)
 */
export async function getBaselineDistribution(
  featureKey: string,
  beforeDate: Date
): Promise<IFeatureDistributionDocument | null> {
  return FeatureDistributionModel.findOne({
    featureKey,
    windowEnd: { $lt: beforeDate }
  })
  .sort({ windowEnd: -1 })
  .lean();
}

/**
 * Save distribution delta
 */
export async function saveDelta(
  delta: Omit<IDistributionDelta, 'createdAt'>
): Promise<IDistributionDeltaDocument> {
  return DistributionDeltaModel.create({
    ...delta,
    createdAt: new Date()
  });
}

/**
 * Get recent deltas with alerts
 */
export async function getRecentDriftAlerts(
  minLevel: DriftAlertLevel = 'WARN',
  limit: number = 50
): Promise<IDistributionDeltaDocument[]> {
  const levels = minLevel === 'CRITICAL' 
    ? ['CRITICAL']
    : minLevel === 'WARN' 
      ? ['WARN', 'CRITICAL']
      : ['INFO', 'WARN', 'CRITICAL'];
  
  return DistributionDeltaModel.find({
    alertLevel: { $in: levels }
  })
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get drift stats
 */
export async function getDriftStats(): Promise<{
  totalDeltas: number;
  byLevel: Record<string, number>;
  criticalFeatures: string[];
}> {
  const [total, byLevel, critical] = await Promise.all([
    DistributionDeltaModel.countDocuments(),
    DistributionDeltaModel.aggregate([
      { $group: { _id: '$alertLevel', count: { $sum: 1 } } }
    ]),
    DistributionDeltaModel.distinct('featureKey', { alertLevel: 'CRITICAL' })
  ]);
  
  return {
    totalDeltas: total,
    byLevel: byLevel.reduce((acc, l) => {
      acc[l._id] = l.count;
      return acc;
    }, {} as Record<string, number>),
    criticalFeatures: critical
  };
}
