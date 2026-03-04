/**
 * P5-FINAL: Auto-Resolve Job
 * 
 * Automatically resolves matured snapshots for all assets.
 * Runs as scheduled job or manual trigger.
 * 
 * Idempotent: repeated runs create 0 new outcomes.
 * No-lookahead: uses candles <= maturityAt.
 */

import { getMongoDb } from '../../db/mongoose.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ResolveJobResult {
  ok: boolean;
  durationMs: number;
  resolvedByAsset: {
    BTC: number;
    SPX: number;
    DXY: number;
    CROSS_ASSET: number;
  };
  totalResolved: number;
  totalSkipped: number;
  errors: string[];
  runAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// RESOLVE FUNCTIONS (per asset)
// ═══════════════════════════════════════════════════════════════

async function getDb() {
  return getMongoDb();
}

/**
 * Resolve BTC matured snapshots
 */
async function resolveBtcSnapshots(): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  const db = await getDb();
  const now = new Date();
  
  // Find unresolved BTC snapshots
  const snapshots = await db.collection('prediction_snapshots').find({
    asset: 'BTC',
    resolved: { $ne: true },
  }).toArray();
  
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  for (const snap of snapshots) {
    try {
      const asOfDate = new Date(snap.asOf);
      const horizonDays = snap.horizonDays || 90;
      const maturityDate = new Date(asOfDate.getTime() + horizonDays * 24 * 60 * 60 * 1000);
      
      // Skip if not mature
      if (now < maturityDate) {
        skipped++;
        continue;
      }
      
      // Check if already resolved (idempotency)
      const existingOutcome = await db.collection('decision_outcomes').findOne({
        asset: 'BTC',
        versionId: snap.versionId,
        horizonDays,
      });
      
      if (existingOutcome) {
        skipped++;
        continue;
      }
      
      // Get prices
      const priceAsOf = await getBtcPriceAtDate(asOfDate);
      const priceMaturity = await getBtcPriceAtDate(maturityDate);
      
      if (!priceAsOf || !priceMaturity) {
        errors.push(`BTC ${snap.versionId}: missing price data`);
        continue;
      }
      
      const realizedReturn = ((priceMaturity - priceAsOf) / priceAsOf) * 100;
      const predictedReturn = (snap.expectedReturn || 0) * 100;
      const error = realizedReturn - predictedReturn;
      
      // Create outcome
      await db.collection('decision_outcomes').insertOne({
        asset: 'BTC',
        versionId: snap.versionId,
        horizonDays,
        asOf: asOfDate,
        maturityAt: maturityDate,
        resolvedAt: now,
        predictedReturnPct: Math.round(predictedReturn * 100) / 100,
        realizedReturnPct: Math.round(realizedReturn * 100) / 100,
        errorPct: Math.round(error * 100) / 100,
        absErrorPct: Math.round(Math.abs(error) * 100) / 100,
        directionHit: Math.sign(realizedReturn) === Math.sign(predictedReturn),
        createdAt: now,
      });
      
      // Mark snapshot resolved
      await db.collection('prediction_snapshots').updateOne(
        { _id: snap._id },
        { $set: { resolved: true, resolvedAt: now, realizedReturn: realizedReturn / 100, error: error / 100 } }
      );
      
      resolved++;
    } catch (err: any) {
      errors.push(`BTC ${snap.versionId}: ${err.message}`);
    }
  }
  
  return { resolved, skipped, errors };
}

/**
 * Resolve SPX matured snapshots
 */
async function resolveSpxSnapshots(): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  const db = await getDb();
  const now = new Date();
  
  const snapshots = await db.collection('prediction_snapshots').find({
    asset: 'SPX',
    resolved: { $ne: true },
  }).toArray();
  
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  for (const snap of snapshots) {
    try {
      const asOfDate = new Date(snap.asOf);
      const horizonDays = snap.horizonDays || 90;
      const maturityDate = new Date(asOfDate.getTime() + horizonDays * 24 * 60 * 60 * 1000);
      
      if (now < maturityDate) {
        skipped++;
        continue;
      }
      
      const existingOutcome = await db.collection('decision_outcomes').findOne({
        asset: 'SPX',
        versionId: snap.versionId,
        horizonDays,
      });
      
      if (existingOutcome) {
        skipped++;
        continue;
      }
      
      const priceAsOf = await getSpxPriceAtDate(asOfDate);
      const priceMaturity = await getSpxPriceAtDate(maturityDate);
      
      if (!priceAsOf || !priceMaturity) {
        errors.push(`SPX ${snap.versionId}: missing price data`);
        continue;
      }
      
      const realizedReturn = ((priceMaturity - priceAsOf) / priceAsOf) * 100;
      const predictedReturn = (snap.expectedReturn || 0) * 100;
      const error = realizedReturn - predictedReturn;
      
      await db.collection('decision_outcomes').insertOne({
        asset: 'SPX',
        versionId: snap.versionId,
        horizonDays,
        asOf: asOfDate,
        maturityAt: maturityDate,
        resolvedAt: now,
        predictedReturnPct: Math.round(predictedReturn * 100) / 100,
        realizedReturnPct: Math.round(realizedReturn * 100) / 100,
        errorPct: Math.round(error * 100) / 100,
        absErrorPct: Math.round(Math.abs(error) * 100) / 100,
        directionHit: Math.sign(realizedReturn) === Math.sign(predictedReturn),
        createdAt: now,
      });
      
      await db.collection('prediction_snapshots').updateOne(
        { _id: snap._id },
        { $set: { resolved: true, resolvedAt: now, realizedReturn: realizedReturn / 100, error: error / 100 } }
      );
      
      resolved++;
    } catch (err: any) {
      errors.push(`SPX ${snap.versionId}: ${err.message}`);
    }
  }
  
  return { resolved, skipped, errors };
}

/**
 * Resolve DXY matured snapshots
 */
async function resolveDxySnapshots(): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  const db = await getDb();
  const now = new Date();
  
  const snapshots = await db.collection('prediction_snapshots').find({
    asset: 'DXY',
    resolved: { $ne: true },
  }).toArray();
  
  let resolved = 0;
  let skipped = 0;
  const errors: string[] = [];
  
  for (const snap of snapshots) {
    try {
      const asOfDate = new Date(snap.asOf);
      const horizonDays = snap.horizonDays || 90;
      const maturityDate = new Date(asOfDate.getTime() + horizonDays * 24 * 60 * 60 * 1000);
      
      if (now < maturityDate) {
        skipped++;
        continue;
      }
      
      const existingOutcome = await db.collection('decision_outcomes').findOne({
        asset: 'DXY',
        versionId: snap.versionId,
        horizonDays,
      });
      
      if (existingOutcome) {
        skipped++;
        continue;
      }
      
      const priceAsOf = await getDxyPriceAtDate(asOfDate);
      const priceMaturity = await getDxyPriceAtDate(maturityDate);
      
      if (!priceAsOf || !priceMaturity) {
        errors.push(`DXY ${snap.versionId}: missing price data`);
        continue;
      }
      
      const realizedReturn = ((priceMaturity - priceAsOf) / priceAsOf) * 100;
      const predictedReturn = (snap.expectedReturn || 0) * 100;
      const error = realizedReturn - predictedReturn;
      
      await db.collection('decision_outcomes').insertOne({
        asset: 'DXY',
        versionId: snap.versionId,
        horizonDays,
        asOf: asOfDate,
        maturityAt: maturityDate,
        resolvedAt: now,
        predictedReturnPct: Math.round(predictedReturn * 100) / 100,
        realizedReturnPct: Math.round(realizedReturn * 100) / 100,
        errorPct: Math.round(error * 100) / 100,
        absErrorPct: Math.round(Math.abs(error) * 100) / 100,
        directionHit: Math.sign(realizedReturn) === Math.sign(predictedReturn),
        createdAt: now,
      });
      
      await db.collection('prediction_snapshots').updateOne(
        { _id: snap._id },
        { $set: { resolved: true, resolvedAt: now, realizedReturn: realizedReturn / 100, error: error / 100 } }
      );
      
      resolved++;
    } catch (err: any) {
      errors.push(`DXY ${snap.versionId}: ${err.message}`);
    }
  }
  
  return { resolved, skipped, errors };
}

/**
 * Resolve CROSS_ASSET matured snapshots
 */
async function resolveCrossAssetSnapshots(): Promise<{ resolved: number; skipped: number; errors: string[] }> {
  try {
    const { resolveAllMatureComposites } = await import('../cross-asset/services/composite.resolve.service.js');
    const result = await resolveAllMatureComposites();
    return {
      resolved: result.resolved,
      skipped: result.skipped,
      errors: result.errors,
    };
  } catch (err: any) {
    return { resolved: 0, skipped: 0, errors: [`CROSS_ASSET: ${err.message}`] };
  }
}

// ═══════════════════════════════════════════════════════════════
// PRICE HELPERS
// ═══════════════════════════════════════════════════════════════

async function getBtcPriceAtDate(targetDate: Date): Promise<number | null> {
  const db = await getDb();
  const candle = await db.collection('fractal_canonical_ohlcv').findOne(
    { ts: { $lte: targetDate } },
    { sort: { ts: -1 } }
  );
  return candle?.ohlcv?.c || candle?.c || null;
}

async function getSpxPriceAtDate(targetDate: Date): Promise<number | null> {
  const db = await getDb();
  const targetTs = targetDate.getTime();
  const candle = await db.collection('spx_candles').findOne(
    { ts: { $lte: targetTs } },
    { sort: { ts: -1 } }
  );
  return candle?.close || candle?.c || null;
}

async function getDxyPriceAtDate(targetDate: Date): Promise<number | null> {
  const db = await getDb();
  const candle = await db.collection('dxy_candles').findOne(
    { date: { $lte: targetDate } },
    { sort: { date: -1 } }
  );
  return candle?.close || candle?.c || null;
}

// ═══════════════════════════════════════════════════════════════
// MAIN JOB
// ═══════════════════════════════════════════════════════════════

/**
 * Run full resolve job for all assets
 */
export async function runResolveJob(): Promise<ResolveJobResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  
  console.log('[ResolveJob] Starting auto-resolve for all assets...');
  
  // Resolve each asset
  const btcResult = await resolveBtcSnapshots();
  const spxResult = await resolveSpxSnapshots();
  const dxyResult = await resolveDxySnapshots();
  const crossResult = await resolveCrossAssetSnapshots();
  
  // Aggregate errors
  errors.push(...btcResult.errors, ...spxResult.errors, ...dxyResult.errors, ...crossResult.errors);
  
  const result: ResolveJobResult = {
    ok: errors.length === 0,
    durationMs: Date.now() - startTime,
    resolvedByAsset: {
      BTC: btcResult.resolved,
      SPX: spxResult.resolved,
      DXY: dxyResult.resolved,
      CROSS_ASSET: crossResult.resolved,
    },
    totalResolved: btcResult.resolved + spxResult.resolved + dxyResult.resolved + crossResult.resolved,
    totalSkipped: btcResult.skipped + spxResult.skipped + dxyResult.skipped + crossResult.skipped,
    errors,
    runAt: new Date(),
  };
  
  console.log(`[ResolveJob] Complete: resolved=${result.totalResolved}, skipped=${result.totalSkipped}, errors=${errors.length}, duration=${result.durationMs}ms`);
  
  return result;
}

export default { runResolveJob };
