/**
 * PHASE 2.2 — Dataset Builder
 * ============================
 * 
 * Constructs ML dataset rows from:
 * - FeatureSnapshot (t0) 
 * - TruthRecord (t1)
 * 
 * RULE: NO future data leakage!
 */

import { DatasetRow, DatasetTarget } from './dataset.types.js';
import { encodeFeatures } from './feature.encoder.js';
import { FeatureSnapshot } from '../features/featureSnapshot.types.js';
import { TruthRecordModel } from '../market/history/truthRecord.model.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEFAULT_HORIZON_BARS = 6;       // 6 hours for 1h timeframe
const HOUR_MS = 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// TRUTH FETCHER
// ═══════════════════════════════════════════════════════════════

interface TruthData {
  timestamp: number;
  priceChangePct: number;
  direction: 1 | -1 | 0;
  confirmed: boolean;
  diverged: boolean;
  outcome: string;
}

/**
 * Get truth record closest to t0 + horizon
 */
async function getTruthAt(
  symbol: string,
  t0: number,
  horizonBars: number
): Promise<TruthData | null> {
  const horizonMs = horizonBars * HOUR_MS;
  const targetT1 = t0 + horizonMs;
  
  // Find truth record closest to target time
  const record = await TruthRecordModel.findOne({
    symbol: symbol.toUpperCase(),
    verdictTs: {
      $gte: t0,
      $lte: targetT1 + HOUR_MS, // allow 1 hour tolerance
    },
  }).sort({ verdictTs: 1 }).lean();
  
  if (!record) return null;
  
  // Compute direction from price change
  const priceChange = record.priceChangePct || 0;
  let direction: 1 | -1 | 0 = 0;
  if (priceChange > 2) direction = 1;
  else if (priceChange < -2) direction = -1;
  
  return {
    timestamp: record.verdictTs,
    priceChangePct: priceChange,
    direction,
    confirmed: record.outcome === 'CONFIRMED',
    diverged: record.outcome === 'DIVERGED',
    outcome: record.outcome,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROW BUILDER
// ═══════════════════════════════════════════════════════════════

function generateRowId(): string {
  return `row_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Build a single dataset row from snapshot + truth
 */
export async function buildDatasetRow(
  snapshot: FeatureSnapshot,
  horizonBars: number = DEFAULT_HORIZON_BARS
): Promise<DatasetRow | null> {
  // Get truth at t0 + horizon
  const truth = await getTruthAt(
    snapshot.symbol,
    snapshot.timestamp,
    horizonBars
  );
  
  if (!truth) {
    return null; // No truth data available
  }
  
  // Encode features
  const features = encodeFeatures(snapshot);
  
  // Build target
  const target: DatasetTarget = {
    priceChangePct: truth.priceChangePct,
    direction: truth.direction,
    confirmed: truth.confirmed,
    diverged: truth.diverged,
    maxAdverseMove: 0,      // TODO: calculate from price history
    maxFavorableMove: 0,    // TODO: calculate from price history
  };
  
  const horizonHours = horizonBars; // 1 bar = 1 hour
  
  return {
    rowId: generateRowId(),
    symbol: snapshot.symbol,
    t0: snapshot.timestamp,
    t1: truth.timestamp,
    snapshotId: snapshot.snapshotId,
    features,
    target,
    meta: {
      horizonBars,
      horizonHours,
      dataQuality: snapshot.meta.dataCompleteness,
      version: 'v1',
    },
  };
}

/**
 * Build dataset rows for multiple horizons
 */
export async function buildDatasetRowsMultiHorizon(
  snapshot: FeatureSnapshot,
  horizons: number[] = [6, 12, 24]
): Promise<DatasetRow[]> {
  const rows: DatasetRow[] = [];
  
  for (const horizon of horizons) {
    const row = await buildDatasetRow(snapshot, horizon);
    if (row) {
      rows.push(row);
    }
  }
  
  return rows;
}

console.log('[Phase 2.2] Dataset Builder loaded');
