/**
 * Outcome Tracker Service
 * 
 * ETAP 3.1: Tracks what actually happened after a prediction.
 * 
 * Responsibilities:
 * - Find "matured" snapshots (1d, 7d, 30d)
 * - Fetch current price using existing price service
 * - Calculate return % and drawdown
 * - Store outcome observation
 * 
 * NO interpretations - pure facts only.
 */
import { PredictionSnapshotModel, type IPredictionSnapshot } from '../models/PredictionSnapshot.model.js';
import { OutcomeObservationModel, type IOutcomeObservation } from '../models/OutcomeObservation.model.js';
import { getLatestPrice } from '../../market/price.service.js';
import { PricePointModel } from '../../market/price_points.model.js';
import type { Horizon, OutcomePoint, OutcomeHorizons } from '../learning.types.js';
import { HORIZON_MS, HORIZONS } from '../learning.types.js';

// ==================== TYPES ====================

export interface TrackerResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  details: TrackerDetail[];
}

export interface TrackerDetail {
  snapshotId: string;
  tokenAddress: string;
  horizon: Horizon;
  status: 'updated' | 'skipped' | 'error';
  reason?: string;
}

export interface MaturedSnapshot {
  snapshot: IPredictionSnapshot;
  pendingHorizons: Horizon[];
}

// ==================== CORE FUNCTIONS ====================

/**
 * Find snapshots that have matured but don't have outcome data yet
 */
export async function findMaturedSnapshots(limit: number = 100): Promise<MaturedSnapshot[]> {
  const now = Date.now();
  const results: MaturedSnapshot[] = [];
  
  // Find all snapshots older than 1 day
  const oldestHorizon = HORIZON_MS['1d'];
  const cutoffDate = new Date(now - oldestHorizon);
  
  const snapshots = await PredictionSnapshotModel.find({
    decidedAt: { $lte: cutoffDate },
  })
    .sort({ decidedAt: 1 }) // Oldest first
    .limit(limit * 2) // Fetch more to account for filtering
    .lean();
  
  for (const snapshot of snapshots) {
    // Get existing observation if any
    const observation = await OutcomeObservationModel.findOne({
      snapshotId: snapshot.snapshotId,
    }).lean();
    
    const decidedAtMs = new Date(snapshot.decidedAt).getTime();
    const pendingHorizons: Horizon[] = [];
    
    for (const horizon of HORIZONS) {
      const horizonMs = HORIZON_MS[horizon];
      const maturedAt = decidedAtMs + horizonMs;
      
      // Check if horizon has matured
      if (now >= maturedAt) {
        // Check if we already have data for this horizon
        const existingData = observation?.horizons?.[horizon];
        if (!existingData) {
          pendingHorizons.push(horizon);
        }
      }
    }
    
    if (pendingHorizons.length > 0) {
      results.push({ snapshot, pendingHorizons });
      if (results.length >= limit) break;
    }
  }
  
  return results;
}

/**
 * Calculate max drawdown from price history
 */
async function calculateMaxDrawdown(
  tokenAddress: string,
  fromDate: Date,
  toDate: Date,
  entryPrice: number
): Promise<number> {
  // Fetch price history
  const priceHistory = await PricePointModel.find({
    assetAddress: tokenAddress.toLowerCase(),
    timestamp: { $gte: fromDate, $lte: toDate },
  })
    .sort({ timestamp: 1 })
    .select('priceUsd')
    .lean();
  
  if (priceHistory.length === 0) {
    return 0;
  }
  
  // Calculate max drawdown from entry price
  let maxDrawdown = 0;
  
  for (const point of priceHistory) {
    const price = typeof point.priceUsd === 'string' 
      ? parseFloat(point.priceUsd) 
      : (point.priceUsd as number);
    
    if (price > 0 && entryPrice > 0) {
      const drawdown = (entryPrice - price) / entryPrice;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
  }
  
  return Math.round(maxDrawdown * 10000) / 100; // Return as percentage
}

/**
 * Track outcome for a single snapshot and horizon
 */
export async function trackOutcome(
  snapshot: IPredictionSnapshot,
  horizon: Horizon
): Promise<TrackerDetail> {
  const result: TrackerDetail = {
    snapshotId: snapshot.snapshotId,
    tokenAddress: snapshot.token.address,
    horizon,
    status: 'error',
  };
  
  try {
    // Get current price
    const currentPrice = await getLatestPrice(snapshot.token.address);
    
    if (!currentPrice) {
      result.reason = 'No current price available';
      return result;
    }
    
    const priceNow = typeof currentPrice.priceUsd === 'string'
      ? parseFloat(currentPrice.priceUsd)
      : (currentPrice.priceUsd as number);
    
    const priceAtDecision = snapshot.market.priceAtDecision;
    
    if (priceAtDecision <= 0 || priceNow <= 0) {
      result.reason = 'Invalid price data';
      return result;
    }
    
    // Calculate return
    const returnPct = ((priceNow - priceAtDecision) / priceAtDecision) * 100;
    
    // Calculate volume change (if available)
    const volumeAtDecision = snapshot.market.volumeAtDecision || 0;
    // Note: We don't have current volume in price points, set to 0
    const volumeNow = 0;
    const volumeChangePct = volumeAtDecision > 0 
      ? ((volumeNow - volumeAtDecision) / volumeAtDecision) * 100 
      : 0;
    
    // Calculate max drawdown
    const horizonMs = HORIZON_MS[horizon];
    const decidedAt = new Date(snapshot.decidedAt);
    const endDate = new Date(decidedAt.getTime() + horizonMs);
    
    const maxDrawdownPct = await calculateMaxDrawdown(
      snapshot.token.address,
      decidedAt,
      endDate,
      priceAtDecision
    );
    
    // Build outcome point
    const outcomePoint: OutcomePoint = {
      price: Math.round(priceNow * 1e8) / 1e8,
      returnPct: Math.round(returnPct * 100) / 100,
      volume: volumeNow,
      volumeChangePct: Math.round(volumeChangePct * 100) / 100,
      maxDrawdownPct,
      resolvedAt: new Date(),
    };
    
    // Upsert outcome observation
    const updatePath = `horizons.${horizon}`;
    await OutcomeObservationModel.findOneAndUpdate(
      { snapshotId: snapshot.snapshotId },
      {
        $set: {
          [updatePath]: outcomePoint,
          tokenAddress: snapshot.token.address.toLowerCase(),
        },
        $setOnInsert: {
          snapshotId: snapshot.snapshotId,
        },
      },
      { upsert: true, new: true }
    );
    
    result.status = 'updated';
    return result;
    
  } catch (error: any) {
    result.reason = error.message || 'Unknown error';
    return result;
  }
}

/**
 * Run outcome tracking cycle
 * Called by worker periodically
 */
export async function runOutcomeTrackingCycle(limit: number = 50): Promise<TrackerResult> {
  console.log('[OutcomeTracker] Starting tracking cycle...');
  
  const result: TrackerResult = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };
  
  try {
    // Find matured snapshots
    const matured = await findMaturedSnapshots(limit);
    console.log(`[OutcomeTracker] Found ${matured.length} snapshots with pending horizons`);
    
    for (const { snapshot, pendingHorizons } of matured) {
      for (const horizon of pendingHorizons) {
        const detail = await trackOutcome(snapshot, horizon);
        result.details.push(detail);
        result.processed++;
        
        switch (detail.status) {
          case 'updated':
            result.updated++;
            break;
          case 'skipped':
            result.skipped++;
            break;
          case 'error':
            result.errors++;
            break;
        }
      }
    }
    
    console.log(`[OutcomeTracker] Cycle complete: ${result.updated} updated, ${result.errors} errors`);
    return result;
    
  } catch (error: any) {
    console.error('[OutcomeTracker] Cycle failed:', error);
    throw error;
  }
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get outcome by snapshot ID
 */
export async function getOutcomeBySnapshotId(
  snapshotId: string
): Promise<IOutcomeObservation | null> {
  return OutcomeObservationModel.findOne({ snapshotId }).lean();
}

/**
 * Get outcomes by token
 */
export async function getOutcomesByToken(
  tokenAddress: string,
  limit: number = 50
): Promise<IOutcomeObservation[]> {
  return OutcomeObservationModel.find({
    tokenAddress: tokenAddress.toLowerCase(),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Get outcome statistics
 */
export async function getOutcomeStats(): Promise<{
  total: number;
  withAll3Horizons: number;
  with1d: number;
  with7d: number;
  with30d: number;
  avgReturn1d: number | null;
  avgReturn7d: number | null;
  avgReturn30d: number | null;
}> {
  const [
    total,
    withAll3,
    with1d,
    with7d,
    with30d,
    returnStats,
  ] = await Promise.all([
    OutcomeObservationModel.countDocuments(),
    OutcomeObservationModel.countDocuments({
      'horizons.1d': { $exists: true },
      'horizons.7d': { $exists: true },
      'horizons.30d': { $exists: true },
    }),
    OutcomeObservationModel.countDocuments({ 'horizons.1d': { $exists: true } }),
    OutcomeObservationModel.countDocuments({ 'horizons.7d': { $exists: true } }),
    OutcomeObservationModel.countDocuments({ 'horizons.30d': { $exists: true } }),
    OutcomeObservationModel.aggregate([
      {
        $group: {
          _id: null,
          avgReturn1d: { $avg: '$horizons.1d.returnPct' },
          avgReturn7d: { $avg: '$horizons.7d.returnPct' },
          avgReturn30d: { $avg: '$horizons.30d.returnPct' },
        },
      },
    ]),
  ]);
  
  const stats = returnStats[0] || {};
  
  return {
    total,
    withAll3Horizons: withAll3,
    with1d,
    with7d,
    with30d,
    avgReturn1d: stats.avgReturn1d ? Math.round(stats.avgReturn1d * 100) / 100 : null,
    avgReturn7d: stats.avgReturn7d ? Math.round(stats.avgReturn7d * 100) / 100 : null,
    avgReturn30d: stats.avgReturn30d ? Math.round(stats.avgReturn30d * 100) / 100 : null,
  };
}

/**
 * Get combined snapshot + outcome data
 */
export async function getSnapshotWithOutcome(
  snapshotId: string
): Promise<{
  snapshot: IPredictionSnapshot;
  outcome: IOutcomeObservation | null;
} | null> {
  const snapshot = await PredictionSnapshotModel.findOne({ snapshotId }).lean();
  if (!snapshot) return null;
  
  const outcome = await OutcomeObservationModel.findOne({ snapshotId }).lean();
  
  return { snapshot, outcome };
}
