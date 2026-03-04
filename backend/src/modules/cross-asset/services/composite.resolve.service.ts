/**
 * P5-A: Composite Resolve Service
 * 
 * Resolves matured composite snapshots into decision outcomes.
 * 
 * Key principles:
 * - Realized return calculated from actual parent returns (BTC/SPX/DXY)
 * - Uses same weights as original composite snapshot
 * - Version isolated - outcomes tied to specific composite version
 * - Idempotent - re-resolve does not create duplicates
 * - No lookahead - uses candles <= maturityAt only
 * - Parent lineage preserved in outcomes
 */

import { getMongoDb } from '../../../db/mongoose.js';
import { CompositeStore } from '../store/composite.store.js';
import type { CompositeSnapshotDoc, ParentVersions } from '../contracts/composite.contract.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CompositeOutcomeDoc {
  asset: 'CROSS_ASSET';
  versionId: string;
  horizonDays: number;
  
  // Parent lineage (preserved from snapshot)
  parentVersions: ParentVersions;
  
  // Timing
  asOf: Date;
  maturityAt: Date;
  resolvedAt: Date;
  
  // Predicted (from snapshot)
  predictedReturnPct: number;
  predictedDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  
  // Realized (from actual parent returns)
  realizedReturnPct: number;
  realizedDirection: 'BULL' | 'BEAR' | 'NEUTRAL';
  
  // Outcomes
  errorPct: number;       // realized - predicted (signed)
  absErrorPct: number;    // |error|
  directionHit: boolean;  // predicted direction == realized direction
  
  // Weights used (for attribution)
  weights: {
    BTC: number;
    SPX: number;
    DXY: number;
  };
  
  // Component contributions
  components: {
    BTC: { returnPct: number; weightedContribution: number };
    SPX: { returnPct: number; weightedContribution: number };
    DXY: { returnPct: number; weightedContribution: number };
  };
  
  // Metadata
  snapshotId?: string;
  createdAt: Date;
}

export interface ResolveResult {
  ok: boolean;
  resolved: number;
  skipped: number;
  errors: string[];
  outcomes: CompositeOutcomeDoc[];
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function getDb() {
  return getMongoDb();
}

/**
 * Get candle close price for asset at or before target date
 * No-lookahead: only uses data available at maturity
 * 
 * Data formats:
 * - BTC: ts (ISODate), ohlcv.c
 * - SPX: ts (timestamp number), close
 * - DXY: date (ISODate), close
 */
async function getAssetPriceAtDate(
  asset: 'BTC' | 'SPX' | 'DXY',
  targetDate: Date
): Promise<number | null> {
  const db = await getDb();
  
  let collection = 'fractal_canonical_ohlcv';
  if (asset === 'SPX') collection = 'spx_candles';
  if (asset === 'DXY') collection = 'dxy_candles';
  
  let candle;
  
  if (asset === 'BTC') {
    // BTC format: ts is ISODate, price in ohlcv.c
    candle = await db.collection(collection).findOne(
      { ts: { $lte: targetDate } },
      { sort: { ts: -1 } }
    );
    if (candle) return candle.ohlcv?.c || candle.c;
  } else if (asset === 'SPX') {
    // SPX format: ts is timestamp number, price in close
    const targetTs = targetDate.getTime();
    candle = await db.collection(collection).findOne(
      { ts: { $lte: targetTs } },
      { sort: { ts: -1 } }
    );
    if (candle) return candle.close || candle.c;
  } else if (asset === 'DXY') {
    // DXY format: date is ISODate, price in close
    candle = await db.collection(collection).findOne(
      { date: { $lte: targetDate } },
      { sort: { date: -1 } }
    );
    if (candle) return candle.close || candle.c;
  }
  
  return null;
}

/**
 * Get asset price at snapshot creation (asOf date)
 */
async function getAssetPriceAtAsOf(
  asset: 'BTC' | 'SPX' | 'DXY',
  asOfDate: Date
): Promise<number | null> {
  return getAssetPriceAtDate(asset, asOfDate);
}

/**
 * Calculate return from two prices
 */
function calculateReturn(startPrice: number, endPrice: number): number {
  if (startPrice <= 0) return 0;
  return ((endPrice - startPrice) / startPrice) * 100;
}

/**
 * Determine direction from return
 */
function getDirection(returnPct: number): 'BULL' | 'BEAR' | 'NEUTRAL' {
  if (returnPct > 0.5) return 'BULL';
  if (returnPct < -0.5) return 'BEAR';
  return 'NEUTRAL';
}

/**
 * Check if snapshot is mature (horizonDays have passed since asOf)
 */
function isSnapshotMature(snapshot: CompositeSnapshotDoc): boolean {
  const asOfDate = new Date(snapshot.asOf);
  const maturityDate = new Date(asOfDate.getTime() + snapshot.horizonDays * 24 * 60 * 60 * 1000);
  return new Date() >= maturityDate;
}

/**
 * Calculate maturity date
 */
function getMaturityDate(snapshot: CompositeSnapshotDoc): Date {
  const asOfDate = new Date(snapshot.asOf);
  return new Date(asOfDate.getTime() + snapshot.horizonDays * 24 * 60 * 60 * 1000);
}

/**
 * Check if outcome already exists (idempotency)
 */
async function outcomeExists(versionId: string, horizonDays: number): Promise<boolean> {
  const db = await getDb();
  const existing = await db.collection('decision_outcomes').findOne({
    asset: 'CROSS_ASSET',
    versionId,
    horizonDays,
  });
  return !!existing;
}

// ═══════════════════════════════════════════════════════════════
// MAIN RESOLVE FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Resolve a single composite snapshot
 * 
 * Algorithm:
 * 1. Check if mature
 * 2. Check idempotency (skip if already resolved)
 * 3. Get parent prices at asOf and maturity
 * 4. Calculate realized returns for each parent
 * 5. Calculate composite realized return using original weights
 * 6. Create outcome document
 * 7. Save to decision_outcomes
 * 8. Mark snapshot as resolved
 */
export async function resolveCompositeSnapshot(
  snapshot: CompositeSnapshotDoc
): Promise<{ ok: boolean; outcome?: CompositeOutcomeDoc; error?: string; skipped?: boolean }> {
  
  // 1. Check maturity
  if (!isSnapshotMature(snapshot)) {
    return { ok: false, error: 'Snapshot not yet mature', skipped: true };
  }
  
  // 2. Check idempotency
  if (await outcomeExists(snapshot.versionId, snapshot.horizonDays)) {
    return { ok: true, skipped: true };
  }
  
  const asOfDate = new Date(snapshot.asOf);
  const maturityDate = getMaturityDate(snapshot);
  const weights = snapshot.computedWeights;
  
  try {
    // 3. Get parent prices at asOf
    const btcPriceAsOf = await getAssetPriceAtAsOf('BTC', asOfDate);
    const spxPriceAsOf = await getAssetPriceAtAsOf('SPX', asOfDate);
    const dxyPriceAsOf = await getAssetPriceAtAsOf('DXY', asOfDate);
    
    // 4. Get parent prices at maturity (no lookahead)
    const btcPriceMaturity = await getAssetPriceAtDate('BTC', maturityDate);
    const spxPriceMaturity = await getAssetPriceAtDate('SPX', maturityDate);
    const dxyPriceMaturity = await getAssetPriceAtDate('DXY', maturityDate);
    
    if (!btcPriceAsOf || !spxPriceAsOf || !dxyPriceAsOf ||
        !btcPriceMaturity || !spxPriceMaturity || !dxyPriceMaturity) {
      return { ok: false, error: 'Missing price data for parents' };
    }
    
    // 5. Calculate realized returns for each parent
    const btcReturn = calculateReturn(btcPriceAsOf, btcPriceMaturity);
    const spxReturn = calculateReturn(spxPriceAsOf, spxPriceMaturity);
    const dxyReturn = calculateReturn(dxyPriceAsOf, dxyPriceMaturity);
    
    // 6. Calculate composite realized return using original weights
    const btcContribution = weights.BTC * btcReturn;
    const spxContribution = weights.SPX * spxReturn;
    const dxyContribution = weights.DXY * dxyReturn;
    
    const realizedReturnPct = btcContribution + spxContribution + dxyContribution;
    
    // 7. Get predicted return from snapshot
    const predictedReturnPct = snapshot.expectedReturn * 100; // Convert from decimal
    
    // 8. Calculate outcomes
    const errorPct = realizedReturnPct - predictedReturnPct;
    const absErrorPct = Math.abs(errorPct);
    const predictedDirection = getDirection(predictedReturnPct);
    const realizedDirection = getDirection(realizedReturnPct);
    const directionHit = predictedDirection === realizedDirection;
    
    // 9. Create outcome document
    const outcome: CompositeOutcomeDoc = {
      asset: 'CROSS_ASSET',
      versionId: snapshot.versionId,
      horizonDays: snapshot.horizonDays,
      parentVersions: snapshot.parentVersions,
      asOf: asOfDate,
      maturityAt: maturityDate,
      resolvedAt: new Date(),
      predictedReturnPct: Math.round(predictedReturnPct * 100) / 100,
      predictedDirection,
      realizedReturnPct: Math.round(realizedReturnPct * 100) / 100,
      realizedDirection,
      errorPct: Math.round(errorPct * 100) / 100,
      absErrorPct: Math.round(absErrorPct * 100) / 100,
      directionHit,
      weights: {
        BTC: weights.BTC,
        SPX: weights.SPX,
        DXY: weights.DXY,
      },
      components: {
        BTC: { returnPct: Math.round(btcReturn * 100) / 100, weightedContribution: Math.round(btcContribution * 100) / 100 },
        SPX: { returnPct: Math.round(spxReturn * 100) / 100, weightedContribution: Math.round(spxContribution * 100) / 100 },
        DXY: { returnPct: Math.round(dxyReturn * 100) / 100, weightedContribution: Math.round(dxyContribution * 100) / 100 },
      },
      createdAt: new Date(),
    };
    
    // 10. Save outcome to decision_outcomes
    const db = await getDb();
    await db.collection('decision_outcomes').insertOne(outcome);
    
    // 11. Mark snapshot as resolved
    await CompositeStore.resolveSnapshot(
      snapshot.versionId,
      snapshot.horizonDays,
      realizedReturnPct / 100, // Convert back to decimal
      errorPct / 100
    );
    
    console.log(`[CompositeResolve] Resolved ${snapshot.versionId} horizon=${snapshot.horizonDays}d: hit=${directionHit}, error=${errorPct.toFixed(2)}%`);
    
    return { ok: true, outcome };
    
  } catch (err: any) {
    console.error(`[CompositeResolve] Error resolving ${snapshot.versionId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Resolve all mature composite snapshots
 */
export async function resolveAllMatureComposites(): Promise<ResolveResult> {
  const unresolvedSnapshots = await CompositeStore.getUnresolvedSnapshots();
  
  console.log(`[CompositeResolve] Found ${unresolvedSnapshots.length} unresolved composite snapshots`);
  
  const result: ResolveResult = {
    ok: true,
    resolved: 0,
    skipped: 0,
    errors: [],
    outcomes: [],
  };
  
  for (const snapshot of unresolvedSnapshots) {
    const resolveResult = await resolveCompositeSnapshot(snapshot);
    
    if (resolveResult.skipped) {
      result.skipped++;
    } else if (resolveResult.ok && resolveResult.outcome) {
      result.resolved++;
      result.outcomes.push(resolveResult.outcome);
    } else if (resolveResult.error) {
      result.errors.push(`${snapshot.versionId}: ${resolveResult.error}`);
    }
  }
  
  return result;
}

/**
 * Force resolve a specific snapshot (for testing)
 * Bypasses maturity check
 */
export async function forceResolveSnapshot(
  versionId: string,
  horizonDays: number
): Promise<{ ok: boolean; outcome?: CompositeOutcomeDoc; error?: string }> {
  const snapshot = await CompositeStore.getSnapshot(versionId, horizonDays);
  
  if (!snapshot) {
    return { ok: false, error: `Snapshot not found: ${versionId} horizon=${horizonDays}` };
  }
  
  // Remove existing outcome for idempotency bypass (force mode)
  const db = await getDb();
  await db.collection('decision_outcomes').deleteOne({
    asset: 'CROSS_ASSET',
    versionId,
    horizonDays,
  });
  
  // Force resolve without maturity check
  return resolveCompositeSnapshotForce(snapshot);
}

/**
 * Internal force resolve (bypasses maturity check)
 */
async function resolveCompositeSnapshotForce(
  snapshot: CompositeSnapshotDoc
): Promise<{ ok: boolean; outcome?: CompositeOutcomeDoc; error?: string }> {
  const asOfDate = new Date(snapshot.asOf);
  // For force mode, use current date as maturity
  const maturityDate = new Date();
  const weights = snapshot.computedWeights;
  
  try {
    // Get parent prices at asOf
    const btcPriceAsOf = await getAssetPriceAtAsOf('BTC', asOfDate);
    const spxPriceAsOf = await getAssetPriceAtAsOf('SPX', asOfDate);
    const dxyPriceAsOf = await getAssetPriceAtAsOf('DXY', asOfDate);
    
    // Get parent prices at maturity (current)
    const btcPriceMaturity = await getAssetPriceAtDate('BTC', maturityDate);
    const spxPriceMaturity = await getAssetPriceAtDate('SPX', maturityDate);
    const dxyPriceMaturity = await getAssetPriceAtDate('DXY', maturityDate);
    
    console.log('[CompositeResolve] Prices:', {
      asOf: asOfDate.toISOString(),
      maturity: maturityDate.toISOString(),
      btcAsOf: btcPriceAsOf,
      spxAsOf: spxPriceAsOf,
      dxyAsOf: dxyPriceAsOf,
      btcMat: btcPriceMaturity,
      spxMat: spxPriceMaturity,
      dxyMat: dxyPriceMaturity,
    });
    
    if (!btcPriceAsOf || !spxPriceAsOf || !dxyPriceAsOf ||
        !btcPriceMaturity || !spxPriceMaturity || !dxyPriceMaturity) {
      return { ok: false, error: 'Missing price data for parents' };
    }
    
    // Calculate realized returns for each parent
    const btcReturn = calculateReturn(btcPriceAsOf, btcPriceMaturity);
    const spxReturn = calculateReturn(spxPriceAsOf, spxPriceMaturity);
    const dxyReturn = calculateReturn(dxyPriceAsOf, dxyPriceMaturity);
    
    // Calculate composite realized return using original weights
    const btcContribution = weights.BTC * btcReturn;
    const spxContribution = weights.SPX * spxReturn;
    const dxyContribution = weights.DXY * dxyReturn;
    
    const realizedReturnPct = btcContribution + spxContribution + dxyContribution;
    
    // Get predicted return from snapshot
    const predictedReturnPct = snapshot.expectedReturn * 100;
    
    // Calculate outcomes
    const errorPct = realizedReturnPct - predictedReturnPct;
    const absErrorPct = Math.abs(errorPct);
    const predictedDirection = getDirection(predictedReturnPct);
    const realizedDirection = getDirection(realizedReturnPct);
    const directionHit = predictedDirection === realizedDirection;
    
    // Create outcome document
    const outcome: CompositeOutcomeDoc = {
      asset: 'CROSS_ASSET',
      versionId: snapshot.versionId,
      horizonDays: snapshot.horizonDays,
      parentVersions: snapshot.parentVersions,
      asOf: asOfDate,
      maturityAt: maturityDate,
      resolvedAt: new Date(),
      predictedReturnPct: Math.round(predictedReturnPct * 100) / 100,
      predictedDirection,
      realizedReturnPct: Math.round(realizedReturnPct * 100) / 100,
      realizedDirection,
      errorPct: Math.round(errorPct * 100) / 100,
      absErrorPct: Math.round(absErrorPct * 100) / 100,
      directionHit,
      weights: {
        BTC: weights.BTC,
        SPX: weights.SPX,
        DXY: weights.DXY,
      },
      components: {
        BTC: { returnPct: Math.round(btcReturn * 100) / 100, weightedContribution: Math.round(btcContribution * 100) / 100 },
        SPX: { returnPct: Math.round(spxReturn * 100) / 100, weightedContribution: Math.round(spxContribution * 100) / 100 },
        DXY: { returnPct: Math.round(dxyReturn * 100) / 100, weightedContribution: Math.round(dxyContribution * 100) / 100 },
      },
      createdAt: new Date(),
    };
    
    // Save outcome to decision_outcomes
    const db = await getDb();
    await db.collection('decision_outcomes').insertOne(outcome);
    
    // Mark snapshot as resolved
    await CompositeStore.resolveSnapshot(
      snapshot.versionId,
      snapshot.horizonDays,
      realizedReturnPct / 100,
      errorPct / 100
    );
    
    console.log(`[CompositeResolve] Force resolved ${snapshot.versionId} horizon=${snapshot.horizonDays}d: hit=${directionHit}, error=${errorPct.toFixed(2)}%`);
    
    return { ok: true, outcome };
    
  } catch (err: any) {
    console.error(`[CompositeResolve] Error force resolving ${snapshot.versionId}:`, err.message);
    return { ok: false, error: err.message };
  }
}

export default {
  resolveCompositeSnapshot,
  resolveAllMatureComposites,
  forceResolveSnapshot,
};
