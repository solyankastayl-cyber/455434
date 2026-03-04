/**
 * PHASE 2.1 — Feature Snapshot Service
 * ======================================
 * 
 * Service layer for creating and retrieving feature snapshots.
 * 
 * OPERATIONS:
 * - Create snapshot (on verdict or backfill)
 * - Get latest snapshot
 * - Get snapshot history
 * - Get snapshot stats
 */

import { FeatureSnapshotModel } from './featureSnapshot.model.js';
import { buildFeatureSnapshot } from './featureSnapshot.builder.js';
import {
  FeatureSnapshot,
  SnapshotStatsResponse,
} from './featureSnapshot.types.js';

// ═══════════════════════════════════════════════════════════════
// CREATE SNAPSHOT
// ═══════════════════════════════════════════════════════════════

/**
 * Create and persist a new feature snapshot
 */
export async function createSnapshot(symbol: string): Promise<FeatureSnapshot> {
  const snapshot = await buildFeatureSnapshot(symbol);
  
  await FeatureSnapshotModel.create(snapshot);
  
  console.log(`[Snapshot] Created ${snapshot.snapshotId} for ${symbol}`);
  
  return snapshot;
}

/**
 * Create snapshot from existing data (for backfill)
 */
export async function createSnapshotFromData(
  snapshot: FeatureSnapshot
): Promise<FeatureSnapshot> {
  await FeatureSnapshotModel.create(snapshot);
  return snapshot;
}

// ═══════════════════════════════════════════════════════════════
// GET SNAPSHOTS
// ═══════════════════════════════════════════════════════════════

/**
 * Get latest snapshot for a symbol
 */
export async function getLatestSnapshot(
  symbol: string
): Promise<FeatureSnapshot | null> {
  const snapshot = await FeatureSnapshotModel
    .findOne({ symbol: symbol.toUpperCase() })
    .sort({ timestamp: -1 })
    .lean();
  
  return snapshot as FeatureSnapshot | null;
}

/**
 * Get snapshot by ID
 */
export async function getSnapshotById(
  snapshotId: string
): Promise<FeatureSnapshot | null> {
  const snapshot = await FeatureSnapshotModel
    .findOne({ snapshotId })
    .lean();
  
  return snapshot as FeatureSnapshot | null;
}

/**
 * Get snapshot history for a symbol
 */
export async function getSnapshotHistory(
  symbol: string,
  options: {
    limit?: number;
    from?: number;
    to?: number;
    minCompleteness?: number;
  } = {}
): Promise<FeatureSnapshot[]> {
  const { limit = 100, from, to, minCompleteness } = options;
  
  const query: any = { symbol: symbol.toUpperCase() };
  
  if (from !== undefined || to !== undefined) {
    query.timestamp = {};
    if (from !== undefined) query.timestamp.$gte = from;
    if (to !== undefined) query.timestamp.$lte = to;
  }
  
  if (minCompleteness !== undefined) {
    query['meta.dataCompleteness'] = { $gte: minCompleteness };
  }
  
  const snapshots = await FeatureSnapshotModel
    .find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
  
  return snapshots as FeatureSnapshot[];
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

/**
 * Get statistics about snapshots for a symbol
 */
export async function getSnapshotStats(
  symbol: string
): Promise<SnapshotStatsResponse['byDataMode'] & {
  total: number;
  avgCompleteness: number;
  timeRange: { from: number; to: number } | null;
}> {
  const normalizedSymbol = symbol.toUpperCase();
  
  const stats = await FeatureSnapshotModel.aggregate([
    { $match: { symbol: normalizedSymbol } },
    {
      $group: {
        _id: '$meta.dataMode',
        count: { $sum: 1 },
        avgCompleteness: { $avg: '$meta.dataCompleteness' },
        minTs: { $min: '$timestamp' },
        maxTs: { $max: '$timestamp' },
      },
    },
  ]);
  
  const result = {
    total: 0,
    avgCompleteness: 0,
    LIVE: 0,
    MOCK: 0,
    MIXED: 0,
    timeRange: null as { from: number; to: number } | null,
  };
  
  let totalCompleteness = 0;
  let minTs = Infinity;
  let maxTs = 0;
  
  for (const stat of stats) {
    const mode = stat._id as 'LIVE' | 'MOCK' | 'MIXED';
    result[mode] = stat.count;
    result.total += stat.count;
    totalCompleteness += stat.avgCompleteness * stat.count;
    
    if (stat.minTs < minTs) minTs = stat.minTs;
    if (stat.maxTs > maxTs) maxTs = stat.maxTs;
  }
  
  if (result.total > 0) {
    result.avgCompleteness = Math.round((totalCompleteness / result.total) * 100) / 100;
    result.timeRange = { from: minTs, to: maxTs };
  }
  
  return result;
}

/**
 * Count snapshots for a symbol
 */
export async function countSnapshots(symbol: string): Promise<number> {
  return FeatureSnapshotModel.countDocuments({ 
    symbol: symbol.toUpperCase() 
  });
}

// ═══════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Get snapshots for dataset building (with filters)
 */
export async function getSnapshotsForDataset(params: {
  symbol: string;
  from: number;
  to: number;
  minCompleteness?: number;
}): Promise<FeatureSnapshot[]> {
  const { symbol, from, to, minCompleteness = 0.6 } = params;
  
  return FeatureSnapshotModel
    .find({
      symbol: symbol.toUpperCase(),
      timestamp: { $gte: from, $lte: to },
      'meta.dataCompleteness': { $gte: minCompleteness },
    })
    .sort({ timestamp: 1 })
    .lean() as Promise<FeatureSnapshot[]>;
}

console.log('[Phase 2.1] FeatureSnapshot Service loaded');
