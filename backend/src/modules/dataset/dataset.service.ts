/**
 * PHASE 2.2 — Dataset Service
 * ============================
 * 
 * Service layer for building and querying ML datasets.
 */

import { DatasetRowModel } from './dataset.model.js';
import { buildDatasetRow } from './dataset.builder.js';
import { FeatureSnapshotModel } from '../features/featureSnapshot.model.js';
import { TruthRecordModel } from '../market/history/truthRecord.model.js';
import { buildFeatureSnapshot } from '../features/featureSnapshot.builder.js';
import { encodeFeatures } from './feature.encoder.js';
import {
  DatasetRow,
  DatasetTarget,
  BuildDatasetResponse,
  DatasetStatsResponse,
  DatasetReadyResponse,
} from './dataset.types.js';

const HOUR_MS = 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// HISTORICAL BACKFILL (creates snapshots + dataset rows from truth)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate historical snapshots and dataset rows from truth records.
 * This is used for bootstrapping the dataset from Phase 1.4 backfill data.
 */
export async function backfillHistoricalDataset(
  symbol: string,
  horizonBars: number = 6
): Promise<BuildDatasetResponse> {
  const normalizedSymbol = symbol.toUpperCase();
  
  // Get all truth records with actual outcomes (not NO_DATA)
  const truthRecords = await TruthRecordModel.find({
    symbol: normalizedSymbol,
    outcome: { $in: ['CONFIRMED', 'DIVERGED'] },
  }).sort({ verdictTs: 1 }).lean();
  
  const result: BuildDatasetResponse = {
    ok: true,
    symbol: normalizedSymbol,
    rowsCreated: 0,
    skipped: {
      noTruth: 0,
      lowQuality: 0,
      alreadyExists: 0,
    },
  };
  
  for (const truth of truthRecords) {
    // Calculate t0 (snapshot time) = truth time - horizon
    const t0 = truth.verdictTs - (horizonBars * HOUR_MS);
    
    // Check if dataset row already exists
    const existingRow = await DatasetRowModel.findOne({
      symbol: normalizedSymbol,
      t0: { $gte: t0 - 1000, $lte: t0 + 1000 }, // 1 second tolerance
    });
    
    if (existingRow) {
      result.skipped.alreadyExists++;
      continue;
    }
    
    // Create synthetic snapshot for this historical point
    const snapshot = await buildFeatureSnapshot(normalizedSymbol);
    
    // Override timestamp to historical t0
    const historicalSnapshot = {
      ...snapshot,
      snapshotId: `snap_hist_${t0}_${Math.random().toString(36).substring(2, 8)}`,
      timestamp: t0,
      meta: {
        ...snapshot.meta,
        dataMode: 'MOCK' as const, // Historical data is always "mock" in this context
      },
    };
    
    // Save historical snapshot
    await FeatureSnapshotModel.create(historicalSnapshot);
    
    // Encode features
    const features = encodeFeatures(historicalSnapshot);
    
    // Build target from truth record
    const priceChange = truth.priceChangePct || 0;
    let direction: 1 | -1 | 0 = 0;
    if (priceChange > 2) direction = 1;
    else if (priceChange < -2) direction = -1;
    
    const target: DatasetTarget = {
      priceChangePct: priceChange,
      direction,
      confirmed: truth.outcome === 'CONFIRMED',
      diverged: truth.outcome === 'DIVERGED',
      maxAdverseMove: 0,
      maxFavorableMove: 0,
    };
    
    // Create dataset row
    const row: DatasetRow = {
      rowId: `row_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      symbol: normalizedSymbol,
      t0,
      t1: truth.verdictTs,
      snapshotId: historicalSnapshot.snapshotId,
      features,
      target,
      meta: {
        horizonBars,
        horizonHours: horizonBars,
        dataQuality: historicalSnapshot.meta.dataCompleteness,
        version: 'v1',
      },
    };
    
    await DatasetRowModel.create(row);
    result.rowsCreated++;
  }
  
  console.log(`[Dataset] Backfilled ${result.rowsCreated} historical rows for ${normalizedSymbol}`);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// BUILD DATASET
// ═══════════════════════════════════════════════════════════════

/**
 * Build dataset for a symbol from existing snapshots
 */
export async function buildDatasetForSymbol(
  symbol: string,
  horizonBars: number = 6
): Promise<BuildDatasetResponse> {
  const normalizedSymbol = symbol.toUpperCase();
  
  // Get all snapshots for symbol
  const snapshots = await FeatureSnapshotModel
    .find({ symbol: normalizedSymbol })
    .sort({ timestamp: 1 })
    .lean();
  
  const result: BuildDatasetResponse = {
    ok: true,
    symbol: normalizedSymbol,
    rowsCreated: 0,
    skipped: {
      noTruth: 0,
      lowQuality: 0,
      alreadyExists: 0,
    },
  };
  
  for (const snapshot of snapshots) {
    // Check if row already exists
    const exists = await DatasetRowModel.findOne({
      snapshotId: snapshot.snapshotId,
      'meta.horizonBars': horizonBars,
    });
    
    if (exists) {
      result.skipped.alreadyExists++;
      continue;
    }
    
    // Skip low quality snapshots
    if (snapshot.meta.dataCompleteness < 0.5) {
      result.skipped.lowQuality++;
      continue;
    }
    
    // Build row
    const row = await buildDatasetRow(snapshot as any, horizonBars);
    
    if (!row) {
      result.skipped.noTruth++;
      continue;
    }
    
    // Save row
    await DatasetRowModel.create(row);
    result.rowsCreated++;
  }
  
  console.log(`[Dataset] Built ${result.rowsCreated} rows for ${normalizedSymbol}`);
  
  return result;
}

/**
 * Build dataset from all available snapshots
 */
export async function buildFullDataset(
  horizonBars: number = 6
): Promise<BuildDatasetResponse> {
  // Get all unique symbols
  const symbols = await FeatureSnapshotModel.distinct('symbol');
  
  const totals: BuildDatasetResponse = {
    ok: true,
    symbol: 'ALL',
    rowsCreated: 0,
    skipped: {
      noTruth: 0,
      lowQuality: 0,
      alreadyExists: 0,
    },
  };
  
  for (const symbol of symbols) {
    const result = await buildDatasetForSymbol(symbol, horizonBars);
    totals.rowsCreated += result.rowsCreated;
    totals.skipped.noTruth += result.skipped.noTruth;
    totals.skipped.lowQuality += result.skipped.lowQuality;
    totals.skipped.alreadyExists += result.skipped.alreadyExists;
  }
  
  return totals;
}

// ═══════════════════════════════════════════════════════════════
// QUERY DATASET
// ═══════════════════════════════════════════════════════════════

/**
 * Get dataset stats for a symbol
 */
export async function getDatasetStats(
  symbol: string
): Promise<DatasetStatsResponse> {
  const normalizedSymbol = symbol.toUpperCase();
  
  const stats = await DatasetRowModel.aggregate([
    { $match: { symbol: normalizedSymbol } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        confirmed: {
          $sum: { $cond: ['$target.confirmed', 1, 0] },
        },
        diverged: {
          $sum: { $cond: ['$target.diverged', 1, 0] },
        },
        avgConfidence: { $avg: '$features.exchangeConfidence' },
        minTs: { $min: '$t0' },
        maxTs: { $max: '$t0' },
      },
    },
  ]);
  
  if (stats.length === 0) {
    return {
      ok: true,
      symbol: normalizedSymbol,
      total: 0,
      confirmed: 0,
      diverged: 0,
      confirmRate: 0,
      avgConfidence: 0,
      timeRange: null,
    };
  }
  
  const s = stats[0];
  return {
    ok: true,
    symbol: normalizedSymbol,
    total: s.total,
    confirmed: s.confirmed,
    diverged: s.diverged,
    confirmRate: s.total > 0 ? s.confirmed / s.total : 0,
    avgConfidence: s.avgConfidence || 0,
    timeRange: s.minTs ? { from: s.minTs, to: s.maxTs } : null,
  };
}

/**
 * Get dataset ready status (for ML training)
 */
export async function getDatasetReadyStatus(): Promise<DatasetReadyResponse> {
  const MIN_COMPLETENESS = 0.6;
  
  // Get stats by quality
  const stats = await DatasetRowModel.aggregate([
    {
      $facet: {
        total: [{ $count: 'count' }],
        usable: [
          { $match: { 'meta.dataQuality': { $gte: MIN_COMPLETENESS } } },
          { $count: 'count' },
        ],
        lowCompleteness: [
          { $match: { 'meta.dataQuality': { $lt: MIN_COMPLETENESS } } },
          { $count: 'count' },
        ],
        bySymbol: [
          { $group: { _id: '$symbol', count: { $sum: 1 } } },
        ],
      },
    },
  ]);
  
  const result = stats[0];
  
  const bySymbol: Record<string, number> = {};
  for (const item of result.bySymbol || []) {
    bySymbol[item._id] = item.count;
  }
  
  return {
    ok: true,
    total: result.total[0]?.count || 0,
    usable: result.usable[0]?.count || 0,
    discarded: {
      lowCompleteness: result.lowCompleteness[0]?.count || 0,
      mockData: 0, // TODO: track mock data separately
      noTarget: 0,
    },
    bySymbol,
  };
}

/**
 * Get dataset rows for ML training
 */
export async function getDatasetForTraining(params: {
  symbol?: string;
  minQuality?: number;
  limit?: number;
  offset?: number;
}): Promise<DatasetRow[]> {
  const { symbol, minQuality = 0.6, limit = 1000, offset = 0 } = params;
  
  const query: any = {
    'meta.dataQuality': { $gte: minQuality },
  };
  
  if (symbol) {
    query.symbol = symbol.toUpperCase();
  }
  
  return DatasetRowModel
    .find(query)
    .sort({ t0: 1 })
    .skip(offset)
    .limit(limit)
    .lean() as Promise<DatasetRow[]>;
}

/**
 * Get sample dataset rows
 */
export async function getSampleRows(
  symbol: string,
  count: number = 10
): Promise<DatasetRow[]> {
  return DatasetRowModel
    .find({ symbol: symbol.toUpperCase() })
    .sort({ t0: -1 })
    .limit(count)
    .lean() as Promise<DatasetRow[]>;
}

console.log('[Phase 2.2] Dataset Service loaded');
