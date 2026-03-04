/**
 * PROJECTION TRACKING SERVICE — Live Overlay System
 * 
 * Stores and retrieves historical projection snapshots for transparency.
 * Shows how forecasts evolved over time vs actual price.
 * 
 * Features:
 * - Save daily projection snapshots
 * - Retrieve last N projections for overlay
 * - Deduplication via input hash
 * - Automatic cleanup of old snapshots
 */

import { getDb } from '../../../db/mongodb.js';
import crypto from 'crypto';
import type {
  HorizonKey,
  ProjectionSnapshot,
  ProjectionTrackingPack,
} from './horizon_meta.contract.js';
import { projectionTrackingConfig as cfg } from './horizon_meta.config.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTION NAME
// ═══════════════════════════════════════════════════════════════

const COLLECTION = 'fractal_projection_snapshots';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function computeInputsHash(
  asset: string,
  horizon: HorizonKey,
  asOf: string,
  series: number[]
): string {
  const data = JSON.stringify({ asset, horizon, asOf, series: series.slice(0, 10) });
  return crypto.createHash('md5').update(data).digest('hex');
}

function daysBetween(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  return Math.abs(Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24)));
}

// ═══════════════════════════════════════════════════════════════
// SAVE SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface SaveSnapshotInput {
  asset: string;
  horizon: HorizonKey;
  asOf: string;
  series: number[];
  confidence: number;
}

export async function saveProjectionSnapshot(input: SaveSnapshotInput): Promise<{
  saved: boolean;
  reason?: string;
}> {
  try {
    const db = getDb();
    const collection = db.collection<ProjectionSnapshot>(COLLECTION);
    
    const inputsHash = computeInputsHash(input.asset, input.horizon, input.asOf, input.series);
    
    // Check for duplicate
    const existing = await collection.findOne({
      asset: input.asset,
      horizon: input.horizon,
      inputsHash,
    });
    
    if (existing) {
      return { saved: false, reason: 'DUPLICATE' };
    }
    
    // Check minimum interval
    const lastSnapshot = await collection.findOne(
      { asset: input.asset, horizon: input.horizon },
      { sort: { storedAt: -1 } }
    );
    
    if (lastSnapshot) {
      const daysSinceLast = daysBetween(lastSnapshot.asOf, input.asOf);
      if (daysSinceLast < cfg.minSnapshotIntervalDays) {
        return { saved: false, reason: 'TOO_RECENT' };
      }
    }
    
    // Insert new snapshot
    await collection.insertOne({
      asset: input.asset,
      horizon: input.horizon,
      asOf: input.asOf,
      series: input.series,
      confidence: input.confidence,
      inputsHash,
      storedAt: new Date(),
    });
    
    // Cleanup old snapshots (keep only maxSnapshots)
    const count = await collection.countDocuments({
      asset: input.asset,
      horizon: input.horizon,
    });
    
    if (count > cfg.maxSnapshots) {
      const toDelete = count - cfg.maxSnapshots;
      const oldest = await collection
        .find({ asset: input.asset, horizon: input.horizon })
        .sort({ storedAt: 1 })
        .limit(toDelete)
        .toArray();
      
      const idsToDelete = oldest.map(s => (s as any)._id);
      if (idsToDelete.length > 0) {
        await collection.deleteMany({ _id: { $in: idsToDelete } });
      }
    }
    
    return { saved: true };
  } catch (err: any) {
    console.error('[ProjectionTracking] Save error:', err.message);
    return { saved: false, reason: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// GET TRACKING PACK
// ═══════════════════════════════════════════════════════════════

export interface GetTrackingInput {
  asset: string;
  horizon: HorizonKey;
  lookback?: number;
  realizedPrices: Array<{ date: string; close: number }>;
}

export async function getProjectionTrackingPack(
  input: GetTrackingInput
): Promise<ProjectionTrackingPack> {
  const db = getDb();
  const collection = db.collection<ProjectionSnapshot>(COLLECTION);
  
  const lookback = input.lookback ?? cfg.trackingLookback;
  
  // Get historical projections
  const snapshots = await collection
    .find({ asset: input.asset, horizon: input.horizon })
    .sort({ storedAt: -1 })
    .limit(lookback)
    .toArray();
  
  const today = new Date().toISOString().split('T')[0];
  
  const projections = snapshots.map(s => ({
    asOf: s.asOf,
    series: s.series,
    confidence: s.confidence,
    daysAgo: daysBetween(s.asOf, today),
  }));
  
  return {
    asset: input.asset,
    horizon: input.horizon,
    realizedPrices: input.realizedPrices,
    projections,
  };
}

// ═══════════════════════════════════════════════════════════════
// ENSURE INDEX
// ═══════════════════════════════════════════════════════════════

export async function ensureProjectionTrackingIndexes(): Promise<void> {
  try {
    const db = getDb();
    const collection = db.collection(COLLECTION);
    
    await collection.createIndex(
      { asset: 1, horizon: 1, storedAt: -1 },
      { background: true }
    );
    
    await collection.createIndex(
      { asset: 1, horizon: 1, inputsHash: 1 },
      { unique: true, background: true }
    );
    
    console.log('[ProjectionTracking] Indexes ensured');
  } catch (err: any) {
    // Ignore duplicate key errors
    if (!err.message?.includes('duplicate key')) {
      console.error('[ProjectionTracking] Index error:', err.message);
    }
  }
}
