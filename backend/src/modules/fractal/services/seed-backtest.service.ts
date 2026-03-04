/**
 * SEED BACKTEST SERVICE
 * 
 * Generates historical snapshots and outcomes for UI testing.
 * 
 * Key principles:
 * - Does NOT affect lifecycle (no promote/rollback events)
 * - Does NOT pollute live metrics (origin = 'seed_backtest')
 * - Uses real historical data with no-lookahead resolve
 * - Marked with seedRunId for tracking
 */

import { v4 as uuidv4 } from 'uuid';
import { SignalSnapshotModel, type DataOrigin } from '../storage/signal-snapshot.schema.js';

export interface SeedBacktestParams {
  scope: 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';
  from: string;        // ISO date: '2022-01-01'
  to: string;          // ISO date: '2024-01-01'
  stepDays: number;    // 7 = weekly
  horizons: string[];  // ['7d', '14d', '30d']
  limit?: number;      // max snapshots to generate
}

export interface SeedBacktestResult {
  ok: boolean;
  seedRunId: string;
  scope: string;
  snapshotsCreated: number;
  outcomesResolved: number;
  dateRange: { from: string; to: string };
  duration: number;
  errors: string[];
}

/**
 * Get candle data for a scope
 */
async function getCandles(scope: string, from: Date, to: Date): Promise<any[]> {
  const mongoose = await import('mongoose');
  const db = mongoose.default.connection.db;
  
  if (!db) {
    throw new Error('MongoDB not connected');
  }
  
  const collectionMap: Record<string, string> = {
    BTC: 'fractal_canonical_ohlcv',
    SPX: 'spx_candles',
    DXY: 'dxy_candles',
    CROSS_ASSET: 'fractal_canonical_ohlcv', // Use BTC as base for composite
  };
  
  const collection = collectionMap[scope];
  if (!collection) return [];
  
  // Different date field handling for different collections
  // BTC: ts as Date, SPX/DXY: date as string or ts as number
  let query: any;
  let sortField: string;
  
  if (scope === 'BTC') {
    query = { ts: { $gte: from, $lte: to } };
    sortField = 'ts';
  } else if (scope === 'SPX') {
    // SPX uses 'date' as string (YYYY-MM-DD)
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];
    query = { date: { $gte: fromStr, $lte: toStr } };
    sortField = 'date';
  } else {
    // DXY uses 'date' as ISODate object
    query = { date: { $gte: from, $lte: to } };
    sortField = 'date';
  }
  
  const candles = await db.collection(collection)
    .find(query)
    .sort({ [sortField]: 1 })
    .toArray();
  
  // Normalize candle format
  return candles.map(c => {
    // Parse date properly
    let dateVal: Date;
    if (c.ts instanceof Date) {
      dateVal = c.ts;
    } else if (typeof c.ts === 'number') {
      dateVal = new Date(c.ts);
    } else if (typeof c.date === 'string') {
      dateVal = new Date(c.date);
    } else {
      dateVal = new Date(c.date || c.ts);
    }
    
    return {
      date: dateVal,
      close: c.ohlcv?.c ?? c.close ?? c.c,
      open: c.ohlcv?.o ?? c.open ?? c.o,
      high: c.ohlcv?.h ?? c.high ?? c.h,
      low: c.ohlcv?.l ?? c.low ?? c.l,
    };
  });
}

/**
 * Get close price at specific date
 */
function getCloseAtDate(candles: any[], targetDate: Date): number | null {
  const targetTs = targetDate.getTime();
  
  // Find candle on or before target date
  for (let i = candles.length - 1; i >= 0; i--) {
    const candleDate = new Date(candles[i].date || candles[i].ts);
    if (candleDate.getTime() <= targetTs) {
      return candles[i].close;
    }
  }
  
  return null;
}

/**
 * Generate mock forecast based on historical trend
 * (Simple momentum-based for seed data)
 */
function generateMockForecast(candles: any[], asOfIndex: number, horizon: number): {
  expectedReturn: number;
  confidence: number;
  action: 'LONG' | 'SHORT' | 'HOLD';
} {
  // Calculate recent momentum (last 30 days before asOf)
  const lookback = Math.min(30, asOfIndex);
  if (lookback < 5) {
    return { expectedReturn: 0, confidence: 0.5, action: 'HOLD' };
  }
  
  const startClose = candles[asOfIndex - lookback].close;
  const endClose = candles[asOfIndex].close;
  const momentum = (endClose - startClose) / startClose;
  
  // Scale momentum to expected return
  const expectedReturn = momentum * (horizon / 30) * (0.5 + Math.random() * 0.5);
  
  // Confidence based on consistency
  const confidence = 0.5 + Math.abs(momentum) * 2;
  
  // Action based on expected return
  let action: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
  if (expectedReturn > 0.02) action = 'LONG';
  else if (expectedReturn < -0.02) action = 'SHORT';
  
  return {
    expectedReturn: Math.round(expectedReturn * 10000) / 10000,
    confidence: Math.min(0.95, Math.max(0.3, confidence)),
    action
  };
}

/**
 * Run Seed Backtest Job
 * 
 * This creates historical snapshots with origin='seed_backtest'
 * and immediately resolves them using no-lookahead data.
 */
export async function runSeedBacktest(params: SeedBacktestParams): Promise<SeedBacktestResult> {
  const startTime = Date.now();
  const seedRunId = `seed_${uuidv4().substring(0, 8)}`;
  const errors: string[] = [];
  
  let snapshotsCreated = 0;
  let outcomesResolved = 0;
  
  try {
    console.log(`[SeedBacktest] Starting ${params.scope} seed from ${params.from} to ${params.to}`);
    
    // Parse dates
    const fromDate = new Date(params.from);
    const toDate = new Date(params.to);
    
    // CROSS_ASSET: Special handling - blend from BTC, SPX, DXY
    if (params.scope === 'CROSS_ASSET') {
      return await runCrossAssetSeed(params, seedRunId, fromDate, toDate);
    }
    
    // Get all candles in range (with buffer for forward lookups)
    const bufferDays = 90; // Max horizon + buffer
    const extendedTo = new Date(toDate.getTime() + bufferDays * 24 * 60 * 60 * 1000);
    const candles = await getCandles(params.scope, fromDate, extendedTo);
    
    if (candles.length < 100) {
      throw new Error(`Insufficient candle data: ${candles.length} candles found`);
    }
    
    console.log(`[SeedBacktest] Loaded ${candles.length} candles`);
    
    // Find candle indices
    const candleDates = candles.map(c => new Date(c.date || c.ts).getTime());
    
    // Iterate through dates with stepDays
    let currentDate = new Date(fromDate);
    const limit = params.limit || 200;
    let count = 0;
    
    while (currentDate <= toDate && count < limit) {
      const asOfTs = currentDate.getTime();
      
      // Find candle index for asOf date
      const asOfIndex = candleDates.findIndex(d => d >= asOfTs);
      if (asOfIndex < 30 || asOfIndex >= candles.length - 90) {
        currentDate = new Date(currentDate.getTime() + params.stepDays * 24 * 60 * 60 * 1000);
        continue;
      }
      
      const asOfCandle = candles[asOfIndex];
      const closeAsOf = asOfCandle.close;
      
      // Generate snapshot for each horizon
      for (const horizonStr of params.horizons) {
        const horizonDays = parseInt(horizonStr);
        
        // Generate mock forecast
        const forecast = generateMockForecast(candles, asOfIndex, horizonDays);
        
        // Calculate maturity date
        const maturityDate = new Date(asOfTs + horizonDays * 24 * 60 * 60 * 1000);
        
        // Find close at maturity (no-lookahead: use candle exactly at or before maturity)
        const closeForward = getCloseAtDate(candles, maturityDate);
        
        if (!closeForward) {
          errors.push(`No forward price for ${currentDate.toISOString()} + ${horizonDays}d`);
          continue;
        }
        
        // Calculate realized return
        const realizedReturn = (closeForward - closeAsOf) / closeAsOf;
        
        // Determine hit (predicted direction correct)
        const hit = (forecast.expectedReturn > 0 && realizedReturn > 0) ||
                    (forecast.expectedReturn < 0 && realizedReturn < 0) ||
                    (Math.abs(forecast.expectedReturn) < 0.01 && Math.abs(realizedReturn) < 0.02);
        
        // Create snapshot with outcome already resolved
        const snapshot = {
          symbol: params.scope,
          asOf: currentDate,
          timeframe: '1D' as const,
          version: 'seed_v1',
          modelId: params.scope,
          modelType: 'ACTIVE' as const,
          
          action: forecast.action,
          dominantHorizon: horizonDays as 7 | 14 | 30,
          expectedReturn: forecast.expectedReturn,
          confidence: forecast.confidence,
          reliability: 0.7,
          entropy: 0.3,
          stability: 0.8,
          
          risk: {
            maxDD_WF: 0.15,
            mcP95_DD: 0.20,
            softStop: 0.10
          },
          
          strategy: {
            preset: 'BALANCED' as const,
            minConf: 0.6,
            maxEntropy: 0.5,
            maxTail: 0.25,
            positionSize: 1.0,
            mode: forecast.action === 'HOLD' ? 'NO_TRADE' as const : 'FULL' as const,
            edgeScore: forecast.confidence * 0.8
          },
          
          metrics: {
            similarityMean: 0.6 + Math.random() * 0.2,
            effectiveN: 15 + Math.floor(Math.random() * 10),
            matchCount: 20 + Math.floor(Math.random() * 10)
          },
          
          phase: 'UNKNOWN' as const,
          
          governance: {
            guardMode: 'NORMAL' as const,
            healthStatus: 'HEALTHY' as const
          },
          
          // Outcomes (already resolved)
          outcomes: {
            [`${horizonDays}d`]: {
              realizedReturn: Math.round(realizedReturn * 10000) / 10000,
              hit,
              resolvedAt: maturityDate,
              closeAsof: closeAsOf,
              closeForward
            }
          },
          resolved: true,
          
          source: 'REPLAY' as const,
          createdAt: new Date(),
          
          // SEED MARKERS
          origin: 'seed_backtest' as DataOrigin,
          seedRunId,
          asOfTs: currentDate
        };
        
        // Upsert snapshot
        await SignalSnapshotModel.updateOne(
          {
            symbol: snapshot.symbol,
            asOf: snapshot.asOf,
            modelType: snapshot.modelType,
            origin: 'seed_backtest',
            'strategy.preset': snapshot.strategy.preset
          },
          { $set: snapshot },
          { upsert: true }
        );
        
        snapshotsCreated++;
        if (hit) outcomesResolved++;
      }
      
      count++;
      currentDate = new Date(currentDate.getTime() + params.stepDays * 24 * 60 * 60 * 1000);
    }
    
    console.log(`[SeedBacktest] Completed: ${snapshotsCreated} snapshots, ${outcomesResolved} hits`);
    
    return {
      ok: true,
      seedRunId,
      scope: params.scope,
      snapshotsCreated,
      outcomesResolved,
      dateRange: { from: params.from, to: params.to },
      duration: Date.now() - startTime,
      errors
    };
    
  } catch (err: any) {
    console.error('[SeedBacktest] Error:', err);
    return {
      ok: false,
      seedRunId,
      scope: params.scope,
      snapshotsCreated,
      outcomesResolved,
      dateRange: { from: params.from, to: params.to },
      duration: Date.now() - startTime,
      errors: [err.message]
    };
  }
}

/**
 * Get seed stats for a scope
 */
export async function getSeedStats(scope: string): Promise<{
  seedCount: number;
  liveCount: number;
  seedRuns: string[];
  dateRange: { from: Date | null; to: Date | null };
}> {
  const seedDocs = await SignalSnapshotModel.find({
    symbol: scope,
    origin: 'seed_backtest'
  }).select('seedRunId asOf').lean();
  
  const liveDocs = await SignalSnapshotModel.countDocuments({
    symbol: scope,
    $or: [
      { origin: 'live' },
      { origin: { $exists: false } }
    ]
  });
  
  const seedRuns = [...new Set(seedDocs.map(d => d.seedRunId).filter(Boolean))];
  const asOfDates = seedDocs.map(d => new Date(d.asOf)).sort((a, b) => a.getTime() - b.getTime());
  
  return {
    seedCount: seedDocs.length,
    liveCount: liveDocs,
    seedRuns,
    dateRange: {
      from: asOfDates[0] || null,
      to: asOfDates[asOfDates.length - 1] || null
    }
  };
}

/**
 * Clear seed data for a scope (or all)
 */
export async function clearSeedData(scope?: string): Promise<{ deleted: number }> {
  const filter: any = { origin: 'seed_backtest' };
  if (scope) filter.symbol = scope;
  
  const result = await SignalSnapshotModel.deleteMany(filter);
  return { deleted: result.deletedCount };
}


/**
 * CROSS_ASSET Seed Backtest
 * 
 * Creates composite snapshots by blending BTC, SPX, DXY forecasts
 * with weights: BTC 50%, SPX 30%, DXY 20%
 */
async function runCrossAssetSeed(
  params: SeedBacktestParams,
  seedRunId: string,
  fromDate: Date,
  toDate: Date
): Promise<SeedBacktestResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let snapshotsCreated = 0;
  let outcomesResolved = 0;
  
  // Weights for composite
  const WEIGHTS = { BTC: 0.5, SPX: 0.3, DXY: 0.2 };
  
  try {
    // Get candles for all three assets
    const bufferDays = 90;
    const extendedTo = new Date(toDate.getTime() + bufferDays * 24 * 60 * 60 * 1000);
    
    const [btcCandles, spxCandles, dxyCandles] = await Promise.all([
      getCandles('BTC', fromDate, extendedTo),
      getCandles('SPX', fromDate, extendedTo),
      getCandles('DXY', fromDate, extendedTo),
    ]);
    
    console.log(`[CrossAsset Seed] BTC: ${btcCandles.length}, SPX: ${spxCandles.length}, DXY: ${dxyCandles.length}`);
    
    // Find common date range
    const minCandles = Math.min(btcCandles.length, spxCandles.length, dxyCandles.length);
    if (minCandles < 100) {
      throw new Error(`Insufficient data for composite: BTC=${btcCandles.length}, SPX=${spxCandles.length}, DXY=${dxyCandles.length}`);
    }
    
    // Use BTC dates as primary timeline
    const btcDates = btcCandles.map(c => new Date(c.date || c.ts).getTime());
    
    // Iterate through dates
    let currentDate = new Date(fromDate);
    const limit = params.limit || 100;
    let count = 0;
    
    while (currentDate <= toDate && count < limit) {
      const asOfTs = currentDate.getTime();
      
      // Find index in BTC
      const asOfIndex = btcDates.findIndex(d => d >= asOfTs);
      if (asOfIndex < 30 || asOfIndex >= btcCandles.length - 90) {
        currentDate = new Date(currentDate.getTime() + params.stepDays * 24 * 60 * 60 * 1000);
        continue;
      }
      
      for (const horizonStr of params.horizons) {
        const horizonDays = parseInt(horizonStr);
        
        // Generate forecasts for each asset
        const btcForecast = generateMockForecast(btcCandles, asOfIndex, horizonDays);
        const spxForecast = generateMockForecast(spxCandles, Math.min(asOfIndex, spxCandles.length - 1), horizonDays);
        const dxyForecast = generateMockForecast(dxyCandles, Math.min(asOfIndex, dxyCandles.length - 1), horizonDays);
        
        // Blend forecasts
        const compositeExpectedReturn = 
          WEIGHTS.BTC * btcForecast.expectedReturn +
          WEIGHTS.SPX * spxForecast.expectedReturn +
          WEIGHTS.DXY * dxyForecast.expectedReturn;
        
        const compositeConfidence = 
          WEIGHTS.BTC * btcForecast.confidence +
          WEIGHTS.SPX * spxForecast.confidence +
          WEIGHTS.DXY * dxyForecast.confidence;
        
        // Calculate realized returns for each asset
        const maturityDate = new Date(asOfTs + horizonDays * 24 * 60 * 60 * 1000);
        
        const btcCloseAsOf = btcCandles[asOfIndex].close;
        const btcCloseForward = getCloseAtDate(btcCandles, maturityDate);
        const btcRealized = btcCloseForward ? (btcCloseForward - btcCloseAsOf) / btcCloseAsOf : 0;
        
        const spxCloseAsOf = spxCandles[Math.min(asOfIndex, spxCandles.length - 1)].close;
        const spxCloseForward = getCloseAtDate(spxCandles, maturityDate);
        const spxRealized = spxCloseForward ? (spxCloseForward - spxCloseAsOf) / spxCloseAsOf : 0;
        
        const dxyCloseAsOf = dxyCandles[Math.min(asOfIndex, dxyCandles.length - 1)].close;
        const dxyCloseForward = getCloseAtDate(dxyCandles, maturityDate);
        const dxyRealized = dxyCloseForward ? (dxyCloseForward - dxyCloseAsOf) / dxyCloseAsOf : 0;
        
        // Composite realized return
        const compositeRealized = 
          WEIGHTS.BTC * btcRealized +
          WEIGHTS.SPX * spxRealized +
          WEIGHTS.DXY * dxyRealized;
        
        // Hit logic
        const hit = (compositeExpectedReturn > 0 && compositeRealized > 0) ||
                    (compositeExpectedReturn < 0 && compositeRealized < 0) ||
                    (Math.abs(compositeExpectedReturn) < 0.01 && Math.abs(compositeRealized) < 0.02);
        
        const actionType = compositeExpectedReturn > 0.02 ? 'LONG' : compositeExpectedReturn < -0.02 ? 'SHORT' : 'HOLD';
        
        // Create composite snapshot with full schema
        const snapshot = {
          symbol: 'CROSS_ASSET',
          asOf: new Date(asOfTs),
          timeframe: '1D' as const,
          version: `composite_${horizonStr}`,
          modelId: 'CROSS_ASSET',
          modelType: 'ACTIVE' as const,
          
          // Core Signal
          action: actionType as 'LONG' | 'SHORT' | 'HOLD',
          dominantHorizon: horizonDays as 7 | 14 | 30,
          expectedReturn: Math.round(compositeExpectedReturn * 10000) / 10000,
          confidence: Math.round(compositeConfidence * 100) / 100,
          reliability: 0.7,
          entropy: 0.3,
          stability: 0.8,
          
          // Risk
          risk: {
            maxDD_WF: 0.12,
            mcP95_DD: 0.18,
            softStop: 0.08
          },
          
          // Strategy
          strategy: {
            preset: 'BALANCED' as const,
            minConf: 0.6,
            maxEntropy: 0.5,
            maxTail: 0.25,
            positionSize: 1.0,
            mode: actionType === 'HOLD' ? 'NO_TRADE' as const : 'FULL' as const,
            edgeScore: compositeConfidence * 0.8
          },
          
          // Metrics
          metrics: {
            similarityMean: 0.65,
            effectiveN: 20,
            matchCount: 30
          },
          
          // Source
          source: 'ENGINE_ASOF' as const,
          
          // Seed metadata
          origin: 'seed_backtest' as DataOrigin,
          seedRunId,
          resolved: true,
          
          // Outcomes
          outcomes: {
            [horizonStr]: {
              resolved: true,
              resolvedAt: maturityDate,
              realizedReturn: Math.round(compositeRealized * 10000) / 10000,
              hit,
              closeAsof: btcCandles[asOfIndex].close,
              closeForward: btcCloseForward || 0,
              // Store component returns for attribution
              components: {
                BTC: Math.round(btcRealized * 10000) / 10000,
                SPX: Math.round(spxRealized * 10000) / 10000,
                DXY: Math.round(dxyRealized * 10000) / 10000,
              }
            }
          },
          
          // Context
          context: {
            weights: WEIGHTS,
            parentForecasts: {
              BTC: btcForecast.expectedReturn,
              SPX: spxForecast.expectedReturn,
              DXY: dxyForecast.expectedReturn,
            }
          },
          
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        
        await SignalSnapshotModel.create(snapshot);
        snapshotsCreated++;
        outcomesResolved++;
      }
      
      count++;
      currentDate = new Date(currentDate.getTime() + params.stepDays * 24 * 60 * 60 * 1000);
    }
    
    console.log(`[CrossAsset Seed] Created ${snapshotsCreated} composite snapshots`);
    
    return {
      ok: true,
      seedRunId,
      scope: 'CROSS_ASSET',
      snapshotsCreated,
      outcomesResolved,
      dateRange: { from: params.from, to: params.to },
      duration: Date.now() - startTime,
      errors
    };
    
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[CrossAsset Seed] Error:`, error);
    return {
      ok: false,
      seedRunId,
      scope: 'CROSS_ASSET',
      snapshotsCreated,
      outcomesResolved,
      dateRange: { from: params.from, to: params.to },
      duration: Date.now() - startTime,
      errors: [error]
    };
  }
}

