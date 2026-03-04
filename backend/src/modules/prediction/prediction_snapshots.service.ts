/**
 * PREDICTION SNAPSHOTS SERVICE
 * 
 * Stores prediction history for transparent model tracking.
 * 
 * Principles:
 * - NO recalculation based on price
 * - Each snapshot is immutable
 * - Old predictions fade to gray, not corrected
 * - Shows model adaptation honestly
 * 
 * Storage trigger rules:
 * - Stance changed
 * - |confidence_new - confidence_old| >= 0.10
 * - series hash changed
 * - >= 24h since last snapshot
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MongoClient, Db, Collection } from 'mongodb';
import crypto from 'crypto';
import { FIXED_HISTORY_START_DATE } from '../../shared/utils/buildFullSeries.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AssetType = 'SPX' | 'DXY' | 'BTC';
export type PredictionView = 'synthetic' | 'hybrid' | 'macro' | 'crossAsset';
export type Stance = 'BULLISH' | 'BEARISH' | 'HOLD';

export interface PredictionPoint {
  t: string;  // ISO timestamp
  v: number;  // absolute price
}

export interface ConfidenceBand {
  p10: PredictionPoint[];
  p90: PredictionPoint[];
}

export interface SnapshotMetadata {
  stance: Stance;
  confidence: number;   // 0..1
  quality?: number;
  modelVersion: string;
}

export interface PredictionSnapshot {
  _id?: any;
  asset: AssetType;
  view: PredictionView;
  horizonDays: number;

  asOf: string;          // prediction start (ISO)
  asOfPrice: number;

  series: PredictionPoint[];
  band?: ConfidenceBand;

  metadata: SnapshotMetadata;
  
  hash: string;
  createdAt: string;
}

export interface SnapshotSaveResult {
  saved: boolean;
  reason?: string;
  snapshotId?: string;
}

// ═══════════════════════════════════════════════════════════════
// MONGODB CONNECTION
// ═══════════════════════════════════════════════════════════════

let _db: Db | null = null;
let _collection: Collection<PredictionSnapshot> | null = null;

async function getCollection(): Promise<Collection<PredictionSnapshot> | null> {
  if (_collection) return _collection;
  
  try {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'fractal_platform';
    const client = new MongoClient(mongoUrl);
    await client.connect();
    _db = client.db(dbName);
    _collection = _db.collection<PredictionSnapshot>('prediction_snapshots');
    
    // Ensure indexes
    await _collection.createIndex({ asset: 1, view: 1, horizonDays: 1, asOf: -1 });
    await _collection.createIndex({ asset: 1, createdAt: -1 });
    
    return _collection;
  } catch (e) {
    console.error('[Snapshots] MongoDB connection failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HASH CALCULATION
// ═══════════════════════════════════════════════════════════════

function calculateSnapshotHash(
  series: PredictionPoint[],
  stance: Stance,
  confidence: number
): string {
  const data = JSON.stringify({
    series: series.map(p => ({ t: p.t, v: Math.round(p.v * 100) / 100 })),
    stance,
    confidence: Math.round(confidence * 100) / 100
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT SAVING LOGIC
// ═══════════════════════════════════════════════════════════════

const CONFIDENCE_THRESHOLD = 0.10;
const MIN_HOURS_BETWEEN_SNAPSHOTS = 24;

export async function shouldSaveSnapshot(
  asset: AssetType,
  view: PredictionView,
  horizonDays: number,
  newHash: string,
  newConfidence: number,
  newStance: Stance
): Promise<{ shouldSave: boolean; reason: string }> {
  const collection = await getCollection();
  if (!collection) {
    return { shouldSave: false, reason: 'no_db' };
  }
  
  // Get latest snapshot for this asset/view/horizon
  const latest = await collection.findOne(
    { asset, view, horizonDays },
    { sort: { asOf: -1 } }
  );
  
  if (!latest) {
    return { shouldSave: true, reason: 'first_snapshot' };
  }
  
  // Check if stance changed
  if (latest.metadata.stance !== newStance) {
    return { shouldSave: true, reason: 'stance_changed' };
  }
  
  // Check if confidence changed significantly
  if (Math.abs(latest.metadata.confidence - newConfidence) >= CONFIDENCE_THRESHOLD) {
    return { shouldSave: true, reason: 'confidence_changed' };
  }
  
  // Check if prediction series changed
  if (latest.hash !== newHash) {
    return { shouldSave: true, reason: 'series_changed' };
  }
  
  // Check if enough time has passed (fallback)
  const hoursSinceLastSnapshot = 
    (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
  
  if (hoursSinceLastSnapshot >= MIN_HOURS_BETWEEN_SNAPSHOTS) {
    return { shouldSave: true, reason: 'time_elapsed' };
  }
  
  return { shouldSave: false, reason: 'no_significant_change' };
}

export async function saveSnapshot(
  asset: AssetType,
  view: PredictionView,
  horizonDays: number,
  asOf: string,
  asOfPrice: number,
  series: PredictionPoint[],
  metadata: SnapshotMetadata,
  band?: ConfidenceBand
): Promise<SnapshotSaveResult> {
  const collection = await getCollection();
  if (!collection) {
    return { saved: false, reason: 'no_db' };
  }
  
  const hash = calculateSnapshotHash(series, metadata.stance, metadata.confidence);
  
  const { shouldSave, reason } = await shouldSaveSnapshot(
    asset,
    view,
    horizonDays,
    hash,
    metadata.confidence,
    metadata.stance
  );
  
  if (!shouldSave) {
    return { saved: false, reason };
  }
  
  const snapshot: PredictionSnapshot = {
    asset,
    view,
    horizonDays,
    asOf,
    asOfPrice,
    series,
    band,
    metadata,
    hash,
    createdAt: new Date().toISOString()
  };
  
  try {
    const result = await collection.insertOne(snapshot as any);
    console.log(`[Snapshots] Saved ${asset}/${view}/${horizonDays}d: ${reason}`);
    return { saved: true, reason, snapshotId: result.insertedId.toString() };
  } catch (e: any) {
    return { saved: false, reason: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT RETRIEVAL
// ═══════════════════════════════════════════════════════════════

export async function getSnapshots(
  asset: AssetType,
  view: PredictionView,
  horizonDays: number,
  limit: number = 12
): Promise<PredictionSnapshot[]> {
  const collection = await getCollection();
  if (!collection) {
    return [];
  }
  
  const snapshots = await collection
    .find({ asset, view, horizonDays })
    .sort({ asOf: -1 })
    .limit(limit)
    .toArray();
  
  // Remove MongoDB _id from response
  return snapshots.map(s => {
    const { _id, ...rest } = s;
    return rest as PredictionSnapshot;
  });
}

export async function getAllSnapshotsForAsset(
  asset: AssetType,
  limit: number = 50
): Promise<PredictionSnapshot[]> {
  const collection = await getCollection();
  if (!collection) {
    return [];
  }
  
  const snapshots = await collection
    .find({ asset })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  
  return snapshots.map(s => {
    const { _id, ...rest } = s;
    return rest as PredictionSnapshot;
  });
}

// ═══════════════════════════════════════════════════════════════
// MARKET CANDLES (from existing data)
// ═══════════════════════════════════════════════════════════════

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

export async function getMarketCandles(
  asset: AssetType,
  fromDate?: string,
  toDate?: string,
  limit: number = 365
): Promise<Candle[]> {
  // Ensure DB connection is established
  if (!_db) {
    await getCollection();
  }
  if (!_db) {
    console.error('[Market Candles] No DB connection');
    return [];
  }
  
  // Map asset to collection
  const collectionMap: Record<AssetType, string> = {
    'BTC': 'fractal_canonical_ohlcv',  // BTC candles in fractal collection
    'SPX': 'spx_candles',
    'DXY': 'dxy_candles'
  };
  
  const candleCollection = _db.collection(collectionMap[asset]);
  
  // BTC has different schema: { ts: Date, ohlcv: {o,h,l,c,v} }
  // SPX/DXY have: { date: string, open, high, low, close }
  if (asset === 'BTC') {
    const query: any = {};
    if (fromDate) query.ts = { $gte: new Date(fromDate) };
    if (toDate) query.ts = { ...query.ts, $lte: new Date(toDate) };
    
    const candles = await candleCollection
      .find(query)
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
    
    return candles.map(c => ({
      t: c.ts instanceof Date ? c.ts.toISOString().split('T')[0] : c.ts,
      o: c.ohlcv?.o || 0,
      h: c.ohlcv?.h || 0,
      l: c.ohlcv?.l || 0,
      c: c.ohlcv?.c || 0
    })).reverse();
  }
  
  // SPX/DXY schema
  // Note: SPX.date is string, DXY.date is datetime object
  const query: any = {};
  
  if (asset === 'DXY') {
    // DXY dates are stored as datetime objects
    if (fromDate) query.date = { $gte: new Date(fromDate) };
    if (toDate) query.date = { ...query.date, $lte: new Date(toDate) };
  } else {
    // SPX dates are stored as strings
    if (fromDate) query.date = { $gte: fromDate };
    if (toDate) query.date = { ...query.date, $lte: toDate };
  }
  
  const candles = await candleCollection
    .find(query)
    .sort({ date: -1 })
    .limit(limit)
    .toArray();
  
  return candles.map(c => ({
    t: c.date instanceof Date ? c.date.toISOString().split('T')[0] : c.date,
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close
  })).reverse();
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerPredictionRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/prediction/snapshots
   * Get prediction snapshots for chart
   */
  app.get('/api/prediction/snapshots', async (request: FastifyRequest, reply: FastifyReply) => {
    const { 
      asset = 'SPX', 
      view = 'crossAsset', 
      horizon = '180',
      limit = '12'
    } = request.query as { 
      asset?: string; 
      view?: string; 
      horizon?: string;
      limit?: string;
    };
    
    const validAssets: AssetType[] = ['SPX', 'DXY', 'BTC'];
    const validViews: PredictionView[] = ['synthetic', 'hybrid', 'macro', 'crossAsset'];
    
    const assetParsed = validAssets.includes(asset as AssetType) 
      ? asset as AssetType 
      : 'SPX';
    const viewParsed = validViews.includes(view as PredictionView) 
      ? view as PredictionView 
      : 'crossAsset';
    const horizonParsed = parseInt(horizon) || 180;
    const limitParsed = Math.min(parseInt(limit) || 12, 50);
    
    const snapshots = await getSnapshots(
      assetParsed,
      viewParsed,
      horizonParsed,
      limitParsed
    );
    
    return reply.send({
      ok: true,
      asset: assetParsed,
      view: viewParsed,
      horizonDays: horizonParsed,
      count: snapshots.length,
      snapshots
    });
  });
  
  /**
   * GET /api/market/candles
   * Get market candles for chart
   * FIXED: Default from = FIXED_HISTORY_START_DATE (2026-01-01)
   */
  app.get('/api/market/candles', async (request: FastifyRequest, reply: FastifyReply) => {
    const { 
      asset = 'SPX', 
      from,
      to,
      limit = '1000'  // Increased default limit
    } = request.query as { 
      asset?: string; 
      from?: string;
      to?: string;
      limit?: string;
    };
    
    const validAssets: AssetType[] = ['SPX', 'DXY', 'BTC'];
    const assetParsed = validAssets.includes(asset as AssetType) 
      ? asset as AssetType 
      : 'SPX';
    
    // FIXED: Default from = FIXED_HISTORY_START_DATE (2026-01-01)
    // History always starts from the same date regardless of horizon
    const fromDate = from || FIXED_HISTORY_START_DATE;
    const toDate = to || new Date().toISOString().split('T')[0];
    
    console.log(`[Market Candles] ${assetParsed}: from=${fromDate} to=${toDate}`);
    
    const candles = await getMarketCandles(
      assetParsed,
      fromDate,
      toDate,
      Math.min(parseInt(limit) || 1000, 2000)
    );
    
    return reply.send({
      ok: true,
      asset: assetParsed,
      from: fromDate,
      to: toDate,
      count: candles.length,
      candles
    });
  });
  
  /**
   * POST /api/prediction/snapshot (internal - save new snapshot)
   */
  app.post('/api/prediction/snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as any;
    
    if (!body.asset || !body.view || !body.series || !body.metadata) {
      return reply.status(400).send({
        ok: false,
        error: 'Missing required fields: asset, view, series, metadata'
      });
    }
    
    const result = await saveSnapshot(
      body.asset,
      body.view,
      body.horizonDays || 180,
      body.asOf || new Date().toISOString(),
      body.asOfPrice || 0,
      body.series,
      body.metadata,
      body.band
    );
    
    return reply.send({
      ok: result.saved,
      ...result
    });
  });
  
  /**
   * GET /api/prediction/stats
   * Get snapshot statistics
   */
  app.get('/api/prediction/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const collection = await getCollection();
    if (!collection) {
      return reply.status(500).send({ ok: false, error: 'No database' });
    }
    
    const stats = await collection.aggregate([
      {
        $group: {
          _id: { asset: '$asset', view: '$view', horizonDays: '$horizonDays' },
          count: { $sum: 1 },
          firstSnapshot: { $min: '$asOf' },
          lastSnapshot: { $max: '$asOf' }
        }
      },
      { $sort: { '_id.asset': 1, '_id.view': 1 } }
    ]).toArray();
    
    const total = await collection.countDocuments();
    
    return reply.send({
      ok: true,
      totalSnapshots: total,
      byAssetViewHorizon: stats
    });
  });
  
  /**
   * GET /api/audit/overview-series
   * Diagnostic endpoint to verify series consistency (F1 spec)
   * 
   * Returns:
   * - historyStartISO (should be 2026-01-01)
   * - asOfISO
   * - candlesFromISO, candlesToISO, candlesCount
   * - seriesFromISO, seriesToISO, seriesCount
   * - anchorTimeISO
   * - anchorCandleClose, anchorSeriesValue, anchorDeltaPct
   * - timeUnit (seconds/ms detect)
   * - errors[] with invariants check
   */
  app.get('/api/audit/overview-series', async (request: FastifyRequest, reply: FastifyReply) => {
    const { 
      asset = 'BTC', 
      horizonDays = '90' 
    } = request.query as { asset?: string; horizonDays?: string };
    
    const validAssets: AssetType[] = ['SPX', 'DXY', 'BTC'];
    const assetParsed = validAssets.includes(asset.toUpperCase() as AssetType) 
      ? asset.toUpperCase() as AssetType 
      : 'BTC';
    const horizonParsed = parseInt(horizonDays) || 90;
    
    const asOfDate = new Date().toISOString().split('T')[0];
    const historyStartISO = FIXED_HISTORY_START_DATE;
    
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Get candles
    const candles = await getMarketCandles(assetParsed, historyStartISO, asOfDate, 2000);
    const candlesFirst = candles[0]?.t || null;
    const candlesLast = candles[candles.length - 1]?.t || null;
    
    // Find anchor candle (last candle <= asOf)
    const anchorCandle = [...candles].reverse().find(c => c.t <= asOfDate);
    const anchorCandleClose = anchorCandle?.c ?? null;
    const anchorCandleTime = anchorCandle?.t ?? null;
    
    // Get latest snapshot (primary source)
    const viewMap: Record<AssetType, PredictionView> = {
      'BTC': 'hybrid',
      'SPX': 'crossAsset', 
      'DXY': 'hybrid',
    };
    let snapshots = await getSnapshots(assetParsed, viewMap[assetParsed], horizonParsed, 1);
    let snapshot = snapshots[0] || null;
    let dataSource = 'snapshot';
    
    // If no snapshot (e.g., DXY uses terminal fallback), try to get data from Overview API
    if (!snapshot || !snapshot.series?.length) {
      try {
        const overviewRes = await fetch(
          `http://localhost:8002/api/ui/overview?asset=${assetParsed.toLowerCase()}&horizon=${horizonParsed}`
        );
        const overviewData = await overviewRes.json();
        
        if (overviewData.ok && overviewData.charts) {
          // Reconstruct snapshot-like data from Overview response
          const actual = overviewData.charts.actual || [];
          const predicted = overviewData.charts.predicted || [];
          const combined = [...actual, ...predicted.slice(1)]; // Avoid duplicate anchor
          
          snapshot = {
            series: combined,
            anchorIndex: actual.length - 1,
            metadata: {
              modelVersion: overviewData.modelVersion,
              stance: overviewData.summary?.stance,
              confidence: overviewData.summary?.confidence,
            },
          };
          dataSource = 'overview_api';
        }
      } catch (e) {
        console.warn('[Audit] Failed to fetch from Overview API:', e);
      }
    }
    
    const seriesFirst = snapshot?.series?.[0]?.t || null;
    const anchorIndex = snapshot?.anchorIndex ?? -1;
    const seriesAnchorPoint = anchorIndex >= 0 ? snapshot?.series?.[anchorIndex] : null;
    const seriesAnchorTime = seriesAnchorPoint?.t ?? null;
    const anchorSeriesValue = seriesAnchorPoint?.v ?? null;
    const seriesLast = snapshot?.series?.[snapshot.series.length - 1]?.t || null;
    const seriesCount = snapshot?.series?.length || 0;
    const forecastCount = anchorIndex >= 0 ? seriesCount - anchorIndex - 1 : 0;
    const historyCount = anchorIndex >= 0 ? anchorIndex : 0;
    
    // Calculate anchor delta (% difference between candle close and series value at anchor)
    let anchorDeltaPct: number | null = null;
    if (anchorCandleClose && anchorSeriesValue && anchorCandleClose > 0) {
      anchorDeltaPct = Math.abs((anchorSeriesValue - anchorCandleClose) / anchorCandleClose) * 100;
    }
    
    // Detect time unit (seconds vs ms) by checking max time value
    // UNIX seconds: < 10^10 (roughly year 2286)
    // UNIX ms: > 10^12 (after 1970)
    let timeUnit = 'unknown';
    const sampleTimeValue = snapshot?.series?.[0]?.t;
    if (typeof sampleTimeValue === 'number') {
      timeUnit = sampleTimeValue > 1e11 ? 'ms' : 'seconds';
    } else if (typeof sampleTimeValue === 'string') {
      timeUnit = 'ISO_string';
    }
    
    // ═══════════════════════════════════════════════════════════════
    // INVARIANTS CHECK (F2 spec)
    // ═══════════════════════════════════════════════════════════════
    
    // 1. candlesFromISO <= 2026-01-01 + 1 candleStep (allow 1 day tolerance)
    if (candlesFirst && candlesFirst > '2026-01-02') {
      errors.push(`INVARIANT_1: candles.first (${candlesFirst}) > historyStart+1day`);
    }
    
    // 2. seriesFromISO should be within reasonable range of candlesFromISO
    // Note: If dataSource is overview_api, series may include more history than candles
    if (seriesFirst && candlesFirst && seriesFirst < candlesFirst && dataSource === 'snapshot') {
      errors.push(`INVARIANT_2: series.first (${seriesFirst}) < candles.first (${candlesFirst})`);
    } else if (seriesFirst && candlesFirst && seriesFirst < candlesFirst) {
      warnings.push(`series includes more history than candles: series.first=${seriesFirst}, candles.first=${candlesFirst}`);
    }
    
    // 3. anchorDeltaPct < 0.3% (ideal) or < 1% (acceptable)
    if (anchorDeltaPct !== null) {
      if (anchorDeltaPct > 1.0) {
        errors.push(`INVARIANT_3: anchorDelta ${anchorDeltaPct.toFixed(2)}% > 1% (candle=${anchorCandleClose}, series=${anchorSeriesValue})`);
      } else if (anchorDeltaPct > 0.3) {
        warnings.push(`anchorDelta ${anchorDeltaPct.toFixed(2)}% > 0.3% but < 1%`);
      }
    }
    
    // 4. forecastLen == horizonDays (or close)
    const expectedForecast = horizonParsed;
    if (forecastCount < expectedForecast * 0.8) {
      errors.push(`INVARIANT_4: forecast.count (${forecastCount}) < 80% of horizon (${expectedForecast})`);
    }
    
    // 5. timeUnit consistency (series should use same unit as candles)
    // Candles always use ISO strings, series should too
    if (timeUnit !== 'ISO_string' && timeUnit !== 'unknown') {
      warnings.push(`series timeUnit is ${timeUnit}, expected ISO_string`);
    }
    
    // Additional checks
    if (anchorIndex < 0 && snapshot) {
      errors.push('anchorIndex is missing from snapshot');
    }
    if (forecastCount === 0 && snapshot) {
      errors.push(`forecast is empty for horizon ${horizonParsed}d`);
    }
    if (seriesCount < 10 && snapshot) {
      errors.push(`series too short: ${seriesCount} points`);
    }
    
    // Check anchor time alignment
    if (anchorCandleTime && seriesAnchorTime && anchorCandleTime !== seriesAnchorTime) {
      warnings.push(`anchor time mismatch: candle=${anchorCandleTime}, series=${seriesAnchorTime}`);
    }
    
    return reply.send({
      ok: errors.length === 0,
      asset: assetParsed,
      horizonDays: horizonParsed,
      
      // A1) History start (should be FIXED)
      historyStartISO,
      
      // A2) Current state
      asOfISO: asOfDate,
      
      // Candles data
      candles: {
        fromISO: candlesFirst,
        toISO: candlesLast,
        count: candles.length,
      },
      
      // Series data
      series: {
        fromISO: seriesFirst,
        toISO: seriesLast,
        count: seriesCount,
        historyCount,
        timeUnit,
      },
      
      // Anchor point (A2)
      anchor: {
        timeISO: seriesAnchorTime || anchorCandleTime,
        candleClose: anchorCandleClose,
        seriesValue: anchorSeriesValue,
        deltaPct: anchorDeltaPct !== null ? Number(anchorDeltaPct.toFixed(4)) : null,
        index: anchorIndex,
      },
      
      // Forecast (A3)
      forecast: {
        count: forecastCount,
        expectedCount: expectedForecast,
        coveragePct: expectedForecast > 0 ? Number((forecastCount / expectedForecast * 100).toFixed(1)) : null,
      },
      
      modelVersion: snapshot?.metadata?.modelVersion || null,
      view: viewMap[assetParsed],
      dataSource,
      
      // Results
      errors,
      warnings,
    });
  });
  
  console.log('[Prediction] Snapshot routes registered at /api/prediction/*');
  console.log('[Prediction] Market candles at /api/market/candles');
  console.log('[Prediction] Audit endpoint at /api/audit/overview-series');
}

export default registerPredictionRoutes;
