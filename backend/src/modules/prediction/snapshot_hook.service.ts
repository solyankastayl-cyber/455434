/**
 * PREDICTION SNAPSHOT HOOK
 * 
 * Auto-save hook for terminal endpoints.
 * Called after compute, before return response.
 * 
 * Save conditions:
 * 1. No previous snapshot for {asset, view, horizonDays}
 * 2. Stance changed
 * 3. |confidence - lastConfidence| > 0.02
 * 4. maxAbsDelta(series, lastSeries) > 0.35% of price
 * 5. >= 24h since last snapshot (heartbeat fallback)
 * 
 * Never save if:
 * - confidence NaN/Inf
 * - series empty or < 5 points
 * - asOf out of valid range
 */

import { MongoClient, Db, Collection } from 'mongodb';
import crypto from 'crypto';

// Re-export unified extractors
export { 
  extractSnapshotPayload,
  extractBtcSnapshotPayload,
  extractSpxSnapshotPayload,
  extractDxySnapshotPayload,
  type SnapshotPayload,
  type AssetType,
  type PredictionView,
  type Stance,
  type PredictionPoint,
} from './unified_extractor.js';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  CONFIDENCE_DELTA_THRESHOLD: 0.02,    // 2% change triggers save
  SERIES_DELTA_THRESHOLD: 0.0035,      // 0.35% price change triggers save
  HEARTBEAT_HOURS: 24,                 // Fallback save interval
  MIN_SERIES_POINTS: 5,                // Minimum points to save
  RATE_LIMIT_MINUTES: 0,               // Disabled for initial generation
  RATE_LIMIT_REPEAT_MINUTES: 15,       // Rate limit only for repeat saves
};

// ═══════════════════════════════════════════════════════════════
// INTERNAL TYPES
// ═══════════════════════════════════════════════════════════════

interface StoredSnapshot {
  asset: string;
  view: string;
  horizonDays: number;
  asOf: string;
  asOfPrice: number;
  series: { t: string; v: number }[];
  anchorIndex?: number;
  metadata: {
    stance: string;
    confidence: number;
  };
  hash: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
// MONGODB
// ═══════════════════════════════════════════════════════════════

let _db: Db | null = null;
let _collection: Collection<StoredSnapshot> | null = null;
const _rateLimitCache: Map<string, number> = new Map();

async function getCollection(): Promise<Collection<StoredSnapshot> | null> {
  if (_collection) return _collection;
  
  try {
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'fractal_platform';
    const client = new MongoClient(mongoUrl);
    await client.connect();
    _db = client.db(dbName);
    _collection = _db.collection<StoredSnapshot>('prediction_snapshots');
    
    // Ensure indexes
    await _collection.createIndex({ asset: 1, view: 1, horizonDays: 1, asOf: -1 });
    await _collection.createIndex({ asset: 1, view: 1, horizonDays: 1, createdAt: -1 });
    
    return _collection;
  } catch (e) {
    console.error('[SnapshotHook] MongoDB failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function calculateHash(series: { t: string; v: number }[], stance: string, confidence: number): string {
  const data = JSON.stringify({
    s: series.slice(0, 10).map(p => Math.round(p.v * 10) / 10),
    st: stance,
    c: Math.round(confidence * 100)
  });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function maxSeriesDelta(
  newSeries: { t: string; v: number }[],
  oldSeries: { t: string; v: number }[],
  basePrice: number
): number {
  if (oldSeries.length === 0 || newSeries.length === 0) return 1; // Force save
  
  let maxDelta = 0;
  const minLen = Math.min(newSeries.length, oldSeries.length);
  
  for (let i = 0; i < minLen; i++) {
    const delta = Math.abs(newSeries[i].v - oldSeries[i].v) / basePrice;
    if (delta > maxDelta) maxDelta = delta;
  }
  
  return maxDelta;
}

function isRateLimited(key: string, isFirst: boolean): boolean {
  if (isFirst) return false; // Never rate-limit first snapshot
  
  const lastSave = _rateLimitCache.get(key);
  if (!lastSave) return false;
  
  const minutesSince = (Date.now() - lastSave) / (1000 * 60);
  return minutesSince < CONFIG.RATE_LIMIT_REPEAT_MINUTES;
}

function setRateLimitTimestamp(key: string): void {
  _rateLimitCache.set(key, Date.now());
}

// ═══════════════════════════════════════════════════════════════
// MAIN HOOK
// ═══════════════════════════════════════════════════════════════

export interface SnapshotHookResult {
  saved: boolean;
  reason: string;
  snapshotId?: string;
}

export interface SnapshotHookPayload {
  asset: string;
  view: string;
  horizonDays: number;
  asOf: string;
  asOfPrice: number;
  series: { t: string; v: number }[];
  anchorIndex?: number;
  stance: string;
  confidence: number;
  modelVersion?: string;
  sourceEndpoint?: string;
  quality?: number;
  band?: { p10: { t: string; v: number }[]; p90: { t: string; v: number }[] };
}

/**
 * Auto-save prediction snapshot after terminal compute.
 * Call this after computing the terminal pack, before returning response.
 */
export async function snapshotHook(payload: SnapshotHookPayload): Promise<SnapshotHookResult> {
  // Validate payload
  if (!payload.series || payload.series.length < CONFIG.MIN_SERIES_POINTS) {
    return { saved: false, reason: 'series_too_short' };
  }
  
  if (!isFinite(payload.confidence) || payload.confidence < 0 || payload.confidence > 1) {
    return { saved: false, reason: 'invalid_confidence' };
  }
  
  const collection = await getCollection();
  if (!collection) {
    return { saved: false, reason: 'no_db' };
  }
  
  // Get latest snapshot
  const latest = await collection.findOne(
    { 
      asset: payload.asset, 
      view: payload.view, 
      horizonDays: payload.horizonDays 
    },
    { sort: { asOf: -1 } }
  );
  
  const key = `${payload.asset}_${payload.view}_${payload.horizonDays}`;
  const isFirst = !latest;
  
  // Check rate limit (skip for first snapshot)
  if (isRateLimited(key, isFirst)) {
    return { saved: false, reason: 'rate_limited' };
  }
  
  const newHash = calculateHash(payload.series, payload.stance, payload.confidence);
  
  // Determine if we should save
  let shouldSave = false;
  let saveReason = '';
  
  if (!latest) {
    shouldSave = true;
    saveReason = 'first_snapshot';
  } else if (latest.metadata.stance !== payload.stance) {
    shouldSave = true;
    saveReason = 'stance_changed';
  } else if (Math.abs(latest.metadata.confidence - payload.confidence) > CONFIG.CONFIDENCE_DELTA_THRESHOLD) {
    shouldSave = true;
    saveReason = 'confidence_delta';
  } else if (maxSeriesDelta(payload.series, latest.series, payload.asOfPrice) > CONFIG.SERIES_DELTA_THRESHOLD) {
    shouldSave = true;
    saveReason = 'series_delta';
  } else {
    // Check heartbeat fallback
    const hoursSinceLast = (Date.now() - new Date(latest.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast >= CONFIG.HEARTBEAT_HOURS) {
      shouldSave = true;
      saveReason = 'heartbeat';
    }
  }
  
  if (!shouldSave) {
    return { saved: false, reason: 'no_significant_change' };
  }
  
  // Build snapshot document
  const snapshot: StoredSnapshot = {
    asset: payload.asset,
    view: payload.view,
    horizonDays: payload.horizonDays,
    asOf: payload.asOf,
    asOfPrice: payload.asOfPrice,
    series: payload.series,
    anchorIndex: payload.anchorIndex,
    metadata: {
      stance: payload.stance,
      confidence: payload.confidence,
    },
    hash: newHash,
    createdAt: new Date().toISOString(),
  };
  
  // Add optional fields
  if (payload.band) {
    (snapshot as any).band = payload.band;
  }
  if (payload.quality !== undefined) {
    (snapshot.metadata as any).quality = payload.quality;
  }
  if (payload.modelVersion) {
    (snapshot.metadata as any).modelVersion = payload.modelVersion;
  }
  if (payload.sourceEndpoint) {
    (snapshot as any).sourceEndpoint = payload.sourceEndpoint;
  }
  
  try {
    const result = await collection.insertOne(snapshot as any);
    setRateLimitTimestamp(key);
    
    console.log(`[SnapshotHook] Saved ${payload.asset}/${payload.view}/${payload.horizonDays}d: ${saveReason} (series=${payload.series.length}, anchor=${payload.anchorIndex || 'N/A'})`);
    
    return {
      saved: true,
      reason: saveReason,
      snapshotId: result.insertedId.toString()
    };
  } catch (e: any) {
    console.error('[SnapshotHook] Save failed:', e.message);
    return { saved: false, reason: `error: ${e.message}` };
  }
}

export default snapshotHook;
