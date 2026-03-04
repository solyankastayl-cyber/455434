/**
 * Feature Snapshot Model (P0.6)
 * 
 * Stores computed feature vectors for ML.
 */

import mongoose, { Schema, Document } from 'mongoose';
import { 
  FeatureVector, 
  FeatureCoverage,
  FeatureSource,
  FEATURE_TAXONOMY_VERSION 
} from '../types/feature.types.js';

// ============================================
// Types
// ============================================

export interface IFeatureSnapshot extends Omit<FeatureVector, 'coverage'> {
  snapshotId: string;
  coverage: FeatureCoverage;
  createdAt: Date;
}

export interface IFeatureSnapshotDocument extends IFeatureSnapshot, Document {}

// ============================================
// Schema
// ============================================

const FeatureCoverageSchema = new Schema<FeatureCoverage>({
  totalFeatures: { type: Number, required: true },
  presentFeatures: { type: Number, required: true },
  nullFeatures: { type: Number, required: true },
  coveragePercent: { type: Number, required: true },
  bySource: { type: Map, of: Object },
  missingCritical: [{ type: String }]
}, { _id: false });

const FeatureSnapshotSchema = new Schema<IFeatureSnapshotDocument>({
  snapshotId: { type: String, required: true, unique: true, index: true },
  
  entityType: { 
    type: String, 
    required: true, 
    enum: ['WALLET', 'TOKEN', 'ACTOR'],
    index: true 
  },
  entityId: { type: String, required: true, lowercase: true, index: true },
  
  windowStart: { type: Date, required: true },
  windowEnd: { type: Date, required: true },
  
  taxonomyVersion: { type: String, required: true, default: FEATURE_TAXONOMY_VERSION },
  
  // Features by source (stored as mixed for flexibility)
  routes: { type: Schema.Types.Mixed, default: {} },
  dex: { type: Schema.Types.Mixed, default: {} },
  market: { type: Schema.Types.Mixed, default: {} },
  actor: { type: Schema.Types.Mixed, default: {} },
  watchlist: { type: Schema.Types.Mixed, default: {} },
  system: { type: Schema.Types.Mixed, default: {} },
  
  coverage: { type: FeatureCoverageSchema, required: true },
  
  buildTimestamp: { type: Date, required: true },
  buildDurationMs: { type: Number, required: true },
  
  createdAt: { type: Date, default: Date.now, index: true }
});

// ============================================
// Indexes
// ============================================

// Query by entity
FeatureSnapshotSchema.index({ entityType: 1, entityId: 1, buildTimestamp: -1 });

// Query by window
FeatureSnapshotSchema.index({ entityId: 1, windowStart: 1, windowEnd: 1 });

// Query by version
FeatureSnapshotSchema.index({ taxonomyVersion: 1, createdAt: -1 });

// Query by coverage
FeatureSnapshotSchema.index({ 'coverage.coveragePercent': -1 });

// ============================================
// Model
// ============================================

export const FeatureSnapshotModel = mongoose.model<IFeatureSnapshotDocument>(
  'ml_feature_snapshots',
  FeatureSnapshotSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate snapshot ID
 */
export function generateSnapshotId(
  entityType: string,
  entityId: string,
  windowStart: Date,
  windowEnd: Date
): string {
  const ts = windowStart.getTime();
  return `SNAP:${entityType}:${entityId.slice(0, 16)}:${ts}`;
}

/**
 * Save feature snapshot
 */
export async function saveFeatureSnapshot(vector: FeatureVector): Promise<IFeatureSnapshotDocument> {
  const snapshotId = generateSnapshotId(
    vector.entityType,
    vector.entityId,
    vector.windowStart,
    vector.windowEnd
  );
  
  const snapshot: IFeatureSnapshot = {
    snapshotId,
    ...vector,
    createdAt: new Date()
  };
  
  return FeatureSnapshotModel.findOneAndUpdate(
    { snapshotId },
    snapshot,
    { upsert: true, new: true }
  );
}

/**
 * Get latest snapshot for entity
 */
export async function getLatestSnapshot(
  entityType: string,
  entityId: string
): Promise<IFeatureSnapshotDocument | null> {
  return FeatureSnapshotModel.findOne({
    entityType,
    entityId: entityId.toLowerCase()
  })
  .sort({ buildTimestamp: -1 })
  .lean();
}

/**
 * Get snapshots for entity
 */
export async function getSnapshotsForEntity(
  entityType: string,
  entityId: string,
  limit: number = 10
): Promise<IFeatureSnapshotDocument[]> {
  return FeatureSnapshotModel.find({
    entityType,
    entityId: entityId.toLowerCase()
  })
  .sort({ buildTimestamp: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats(): Promise<{
  totalSnapshots: number;
  byEntityType: Record<string, number>;
  avgCoverage: number;
  byVersion: Record<string, number>;
}> {
  const [total, byType, avgCov, byVersion] = await Promise.all([
    FeatureSnapshotModel.countDocuments(),
    
    FeatureSnapshotModel.aggregate([
      { $group: { _id: '$entityType', count: { $sum: 1 } } }
    ]),
    
    FeatureSnapshotModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$coverage.coveragePercent' } } }
    ]),
    
    FeatureSnapshotModel.aggregate([
      { $group: { _id: '$taxonomyVersion', count: { $sum: 1 } } }
    ])
  ]);
  
  return {
    totalSnapshots: total,
    byEntityType: byType.reduce((acc, t) => {
      acc[t._id] = t.count;
      return acc;
    }, {} as Record<string, number>),
    avgCoverage: Math.round((avgCov[0]?.avg || 0) * 100) / 100,
    byVersion: byVersion.reduce((acc, v) => {
      acc[v._id] = v.count;
      return acc;
    }, {} as Record<string, number>)
  };
}
