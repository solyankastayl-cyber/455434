/**
 * Feature Coverage Snapshot Model (P0.7)
 * 
 * Records feature coverage, freshness, and gate decisions.
 * Safety layer for ML - determines if data is usable.
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================
// Types
// ============================================

export type BlockReason = 
  | 'LOW_TOTAL_COVERAGE'
  | 'LOW_ROUTES_COVERAGE'
  | 'LOW_DEX_COVERAGE'
  | 'LOW_ACTOR_COVERAGE'
  | 'STALE_DATA'
  | 'STALE_ROUTES_DATA'
  | 'STALE_DEX_DATA'
  | 'STALE_MARKET_DATA'
  | 'MISSING_CRITICAL_FEATURES'
  | 'HIGH_NULL_RATIO'
  | 'DRIFT_DETECTED';

export interface ISourceCoverage {
  total: number;
  present: number;
  missing: number;
  ratio: number;
}

export interface ICoverageStats {
  totalFeatures: number;
  presentFeatures: number;
  missingFeatures: number;
  coverageRatio: number;
  nullRatio: number;
}

export interface IFreshnessStats {
  maxLagMs: number;
  avgLagMs: number;
  perSourceLag: Record<string, number>;
  oldestDataTimestamp?: Date;
  newestDataTimestamp?: Date;
}

export interface IGateDecision {
  allowed: boolean;
  blockedBy: BlockReason[];
  score: number; // 0-100, overall quality score
  timestamp: Date;
}

export interface IFeatureCoverageSnapshot {
  snapshotId: string;
  
  // Entity info
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  
  // Time context
  windowStart: Date;
  windowEnd: Date;
  timestamp: Date;
  
  // Coverage stats
  coverage: ICoverageStats;
  
  // Per-source breakdown
  bySource: {
    ROUTES: ISourceCoverage;
    DEX: ISourceCoverage;
    ACTOR: ISourceCoverage;
    WATCHLIST: ISourceCoverage;
    SYSTEM: ISourceCoverage;
    MARKET: ISourceCoverage;
  };
  
  // Data freshness
  freshness: IFreshnessStats;
  
  // Missing critical features
  missingCritical: string[];
  
  // Gate decision
  decision: IGateDecision;
  
  // Link to feature snapshot
  featureSnapshotId?: string;
  
  // Metadata
  version: string;
  createdAt: Date;
}

export interface IFeatureCoverageSnapshotDocument extends IFeatureCoverageSnapshot, Document {}

// ============================================
// Schema
// ============================================

const SourceCoverageSchema = new Schema<ISourceCoverage>({
  total: { type: Number, required: true },
  present: { type: Number, required: true },
  missing: { type: Number, required: true },
  ratio: { type: Number, required: true }
}, { _id: false });

const CoverageStatsSchema = new Schema<ICoverageStats>({
  totalFeatures: { type: Number, required: true },
  presentFeatures: { type: Number, required: true },
  missingFeatures: { type: Number, required: true },
  coverageRatio: { type: Number, required: true },
  nullRatio: { type: Number, required: true }
}, { _id: false });

const FreshnessStatsSchema = new Schema<IFreshnessStats>({
  maxLagMs: { type: Number, required: true },
  avgLagMs: { type: Number, required: true },
  perSourceLag: { type: Map, of: Number },
  oldestDataTimestamp: { type: Date },
  newestDataTimestamp: { type: Date }
}, { _id: false });

const GateDecisionSchema = new Schema<IGateDecision>({
  allowed: { type: Boolean, required: true },
  blockedBy: [{ type: String }],
  score: { type: Number, required: true },
  timestamp: { type: Date, required: true }
}, { _id: false });

const FeatureCoverageSnapshotSchema = new Schema<IFeatureCoverageSnapshotDocument>({
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
  timestamp: { type: Date, required: true, index: true },
  
  coverage: { type: CoverageStatsSchema, required: true },
  
  bySource: {
    ROUTES: { type: SourceCoverageSchema, required: true },
    DEX: { type: SourceCoverageSchema, required: true },
    ACTOR: { type: SourceCoverageSchema, required: true },
    WATCHLIST: { type: SourceCoverageSchema, required: true },
    SYSTEM: { type: SourceCoverageSchema, required: true },
    MARKET: { type: SourceCoverageSchema, required: true }
  },
  
  freshness: { type: FreshnessStatsSchema, required: true },
  
  missingCritical: [{ type: String }],
  
  decision: { type: GateDecisionSchema, required: true },
  
  featureSnapshotId: { type: String, index: true },
  
  version: { type: String, default: 'v1' },
  createdAt: { type: Date, default: Date.now, index: true }
});

// ============================================
// Indexes
// ============================================

FeatureCoverageSnapshotSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
FeatureCoverageSnapshotSchema.index({ 'decision.allowed': 1, timestamp: -1 });
FeatureCoverageSnapshotSchema.index({ 'coverage.coverageRatio': 1 });

// ============================================
// Model
// ============================================

export const FeatureCoverageSnapshotModel = mongoose.model<IFeatureCoverageSnapshotDocument>(
  'ml_feature_coverage_snapshots',
  FeatureCoverageSnapshotSchema
);

// ============================================
// Helper Functions
// ============================================

/**
 * Generate coverage snapshot ID
 */
export function generateCoverageSnapshotId(
  entityType: string,
  entityId: string,
  timestamp: Date
): string {
  const ts = timestamp.getTime();
  return `COV:${entityType}:${entityId.slice(0, 16)}:${ts}`;
}

/**
 * Save coverage snapshot
 */
export async function saveCoverageSnapshot(
  snapshot: Omit<IFeatureCoverageSnapshot, 'snapshotId' | 'createdAt'>
): Promise<IFeatureCoverageSnapshotDocument> {
  const snapshotId = generateCoverageSnapshotId(
    snapshot.entityType,
    snapshot.entityId,
    snapshot.timestamp
  );
  
  const doc: IFeatureCoverageSnapshot = {
    ...snapshot,
    snapshotId,
    createdAt: new Date()
  };
  
  return FeatureCoverageSnapshotModel.findOneAndUpdate(
    { snapshotId },
    doc,
    { upsert: true, new: true }
  );
}

/**
 * Get latest coverage for entity
 */
export async function getLatestCoverage(
  entityType: string,
  entityId: string
): Promise<IFeatureCoverageSnapshotDocument | null> {
  return FeatureCoverageSnapshotModel.findOne({
    entityType,
    entityId: entityId.toLowerCase()
  })
  .sort({ timestamp: -1 })
  .lean();
}

/**
 * Get coverage history
 */
export async function getCoverageHistory(
  entityType: string,
  entityId: string,
  limit: number = 20
): Promise<IFeatureCoverageSnapshotDocument[]> {
  return FeatureCoverageSnapshotModel.find({
    entityType,
    entityId: entityId.toLowerCase()
  })
  .sort({ timestamp: -1 })
  .limit(limit)
  .lean();
}

/**
 * Get blocked entities (gates failed)
 */
export async function getBlockedEntities(
  since?: Date,
  limit: number = 50
): Promise<IFeatureCoverageSnapshotDocument[]> {
  const query: any = { 'decision.allowed': false };
  if (since) {
    query.timestamp = { $gte: since };
  }
  
  return FeatureCoverageSnapshotModel.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get coverage statistics
 */
export async function getCoverageStats(): Promise<{
  totalSnapshots: number;
  allowedCount: number;
  blockedCount: number;
  avgCoverage: number;
  avgQualityScore: number;
  blockReasons: Record<string, number>;
}> {
  const [total, allowed, blocked, avgMetrics, reasons] = await Promise.all([
    FeatureCoverageSnapshotModel.countDocuments(),
    FeatureCoverageSnapshotModel.countDocuments({ 'decision.allowed': true }),
    FeatureCoverageSnapshotModel.countDocuments({ 'decision.allowed': false }),
    FeatureCoverageSnapshotModel.aggregate([
      {
        $group: {
          _id: null,
          avgCoverage: { $avg: '$coverage.coverageRatio' },
          avgScore: { $avg: '$decision.score' }
        }
      }
    ]),
    FeatureCoverageSnapshotModel.aggregate([
      { $unwind: '$decision.blockedBy' },
      { $group: { _id: '$decision.blockedBy', count: { $sum: 1 } } }
    ])
  ]);
  
  const metrics = avgMetrics[0] || { avgCoverage: 0, avgScore: 0 };
  
  return {
    totalSnapshots: total,
    allowedCount: allowed,
    blockedCount: blocked,
    avgCoverage: Math.round((metrics.avgCoverage || 0) * 100) / 100,
    avgQualityScore: Math.round(metrics.avgScore || 0),
    blockReasons: reasons.reduce((acc, r) => {
      acc[r._id] = r.count;
      return acc;
    }, {} as Record<string, number>)
  };
}
