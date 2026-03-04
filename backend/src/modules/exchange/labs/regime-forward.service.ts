/**
 * S10.LABS-01 — Regime Forward Outcome Service
 * 
 * Analyzes what happens AFTER each regime.
 * 
 * RULES:
 * - Read-only (no mutations)
 * - Causal: t1 >= t0 + horizon
 * - No signals, no predictions
 * - Statistics only
 */

import { MongoClient, Db, Collection } from 'mongodb';
import {
  RegimeForwardQuery,
  RegimeForwardResponse,
  RegimeForwardEntry,
  RegimeForwardTotals,
  RegimeDistributionItem,
  StressDelta,
  StressBucket,
  PatternTrigger,
  HORIZON_MS,
  HORIZON_MS_MOCK,
  WINDOW_MS,
  CASCADE_THRESHOLDS,
} from './labs.types.js';
import { RegimeType, ExchangeObservationRow } from '../observation/observation.types.js';
import { computeMarketAggregates } from '../indicators/indicator.aggregates.js';

// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';
const COLLECTION_NAME = 'exchange_observations';

let db: Db | null = null;
let collection: Collection<ExchangeObservationRow> | null = null;

async function getCollection(): Promise<Collection<ExchangeObservationRow>> {
  if (collection) return collection;
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  collection = db.collection<ExchangeObservationRow>(COLLECTION_NAME);
  
  console.log(`[S10.LABS] Connected to MongoDB, collection: ${COLLECTION_NAME}`);
  return collection;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export async function calculateRegimeForward(
  query: RegimeForwardQuery
): Promise<RegimeForwardResponse> {
  const coll = await getCollection();
  
  const now = Date.now();
  const windowMs = WINDOW_MS[query.window];
  
  // Check if we're dealing with mock data (close timestamps)
  // If average gap between observations is < 1 second, use mock horizons
  const startTime = now - windowMs;
  
  // ─────────────────────────────────────────────────────────────
  // Step 1: Fetch all observations in window
  // ─────────────────────────────────────────────────────────────
  
  const observations = await coll
    .find({
      symbol: query.symbol.toUpperCase(),
      timestamp: { $gte: startTime },
    })
    .sort({ timestamp: 1 })
    .toArray();
  
  // Detect if mock data (close timestamps)
  let isMockData = false;
  if (observations.length >= 2) {
    const avgGap = (observations[observations.length - 1].timestamp - observations[0].timestamp) 
                   / (observations.length - 1);
    isMockData = avgGap < 1000; // Less than 1 second between observations
  }
  
  const horizonMs = isMockData ? HORIZON_MS_MOCK[query.horizon] : HORIZON_MS[query.horizon];
  
  const totalObservations = observations.length;
  
  // ─────────────────────────────────────────────────────────────
  // Step 2: Build t0 -> t1 pairs
  // ─────────────────────────────────────────────────────────────
  
  interface ObservationPair {
    t0: any;
    t1: any;
    regime: RegimeType;
    nextRegime: RegimeType;
    stressT0: number;
    stressT1: number;
    cascadeT1: boolean;
    patternsT0: string[];
  }
  
  const pairs: ObservationPair[] = [];
  let droppedNoForward = 0;
  let droppedUnstable = 0;
  
  for (let i = 0; i < observations.length; i++) {
    const t0 = observations[i];
    const targetTs = t0.timestamp + horizonMs;
    
    // Check stability (use confidence as proxy for stability)
    const regimeConfidence = t0.regime?.confidence ?? 0.5;
    if (regimeConfidence < 0.3) {  // Lowered threshold
      droppedUnstable++;
      continue;
    }
    
    // Find t1: first observation >= targetTs
    let t1 = null;
    for (let j = i + 1; j < observations.length; j++) {
      if (observations[j].timestamp >= targetTs) {
        t1 = observations[j];
        break;
      }
    }
    
    if (!t1) {
      droppedNoForward++;
      continue;
    }
    
    // Get regime based on source
    const regime = getRegime(t0, query.regimeSource);
    const nextRegime = getRegime(t1, query.regimeSource);
    
    // Get stress metric
    const stressT0 = getStressMetric(t0, query.stressMetric);
    const stressT1 = getStressMetric(t1, query.stressMetric);
    
    // Check cascade
    const cascadeT1 = isCascadeActive(t1);
    
    // Get patterns at t0
    const patternsT0 = (t0.patterns || []).map((p: any) => p.patternId || p.name);
    
    pairs.push({
      t0,
      t1,
      regime,
      nextRegime,
      stressT0,
      stressT1,
      cascadeT1,
      patternsT0,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 3: Group by regime and calculate statistics
  // ─────────────────────────────────────────────────────────────
  
  const regimeGroups = new Map<RegimeType, ObservationPair[]>();
  
  for (const pair of pairs) {
    if (!regimeGroups.has(pair.regime)) {
      regimeGroups.set(pair.regime, []);
    }
    regimeGroups.get(pair.regime)!.push(pair);
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 4: Build response entries
  // ─────────────────────────────────────────────────────────────
  
  const byRegime: RegimeForwardEntry[] = [];
  
  const regimeKeys = Array.from(regimeGroups.keys());
  for (const regime of regimeKeys) {
    const regimePairs = regimeGroups.get(regime)!;
    if (regimePairs.length < 5) continue; // Skip tiny samples
    
    const entry = calculateRegimeEntry(regime, regimePairs, query.bucketSize);
    byRegime.push(entry);
  }
  
  // Sort by sample count
  byRegime.sort((a, b) => b.sampleCount - a.sampleCount);
  
  // ─────────────────────────────────────────────────────────────
  // Step 5: Generate interpretation notes
  // ─────────────────────────────────────────────────────────────
  
  const notes = generateNotes(byRegime, query.horizon);
  
  // ─────────────────────────────────────────────────────────────
  // Step 6: Build response
  // ─────────────────────────────────────────────────────────────
  
  const totals: RegimeForwardTotals = {
    observations: totalObservations,
    usablePairs: pairs.length,
    droppedNoForward,
    droppedUnstable,
  };
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
      regimeSource: query.regimeSource,
      minStabilityTicks: query.minStabilityTicks,
      stressMetric: query.stressMetric,
      generatedAt: new Date().toISOString(),
    },
    totals,
    byRegime,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getRegime(obs: any, source: string): RegimeType {
  // For now, use the stored regime type
  // In the future, could recalculate from indicators if source === 'indicator'
  return obs.regime?.type || 'NEUTRAL';
}

function getStressMetric(obs: any, metric: string): number {
  // Try to get from computed aggregates if available
  // Otherwise estimate from raw data
  
  const indicators = obs.indicators || {};
  
  if (Object.keys(indicators).length > 10) {
    // Compute aggregates on the fly
    const agg = computeMarketAggregates(indicators);
    
    switch (metric) {
      case 'marketStress': return agg.marketStress;
      case 'orderbookPressure': return Math.abs(agg.orderbookPressure); // normalize to 0..1
      case 'positionCrowding': return agg.positionCrowding;
      default: return agg.marketStress;
    }
  }
  
  // Fallback: estimate from volatility + liquidations
  const volatility = obs.market?.volatility || 0;
  const cascadeActive = obs.liquidations?.cascadeActive || false;
  
  return cascadeActive ? 0.8 : Math.min(1, volatility * 10 + 0.3);
}

function isCascadeActive(obs: any): boolean {
  const liq = obs.liquidations || {};
  
  // Check explicit cascade flag
  if (liq.cascadeActive === true) return true;
  
  // Check intensity threshold
  if (liq.intensity >= CASCADE_THRESHOLDS.intensityMin) return true;
  
  // Check stress + volume (would need historical data)
  // Simplified: just use the cascade flag
  
  return false;
}

function calculateRegimeEntry(
  regime: RegimeType,
  pairs: any[],
  bucketSize: number
): RegimeForwardEntry {
  const sampleCount = pairs.length;
  
  // ─────────────────────────────────────────────────────────────
  // Next Regime Distribution
  // ─────────────────────────────────────────────────────────────
  
  const nextRegimeCounts = new Map<RegimeType, number>();
  let regimeChanges = 0;
  
  for (const pair of pairs) {
    const next = pair.nextRegime;
    nextRegimeCounts.set(next, (nextRegimeCounts.get(next) || 0) + 1);
    
    if (next !== regime) regimeChanges++;
  }
  
  const nextRegimeDist: RegimeDistributionItem[] = [];
  const nextRegimeKeys = Array.from(nextRegimeCounts.keys());
  for (const r of nextRegimeKeys) {
    const count = nextRegimeCounts.get(r)!;
    nextRegimeDist.push({
      regime: r,
      count,
      pct: Math.round((count / sampleCount) * 100),
    });
  }
  nextRegimeDist.sort((a, b) => b.count - a.count);
  
  const regimeChangeRate = regimeChanges / sampleCount;
  
  // ─────────────────────────────────────────────────────────────
  // Stress Delta Distribution
  // ─────────────────────────────────────────────────────────────
  
  const stressDeltas = pairs.map(p => p.stressT1 - p.stressT0);
  stressDeltas.sort((a, b) => a - b);
  
  const mean = stressDeltas.reduce((a, b) => a + b, 0) / stressDeltas.length;
  const p50 = stressDeltas[Math.floor(stressDeltas.length * 0.5)];
  const p90 = stressDeltas[Math.floor(stressDeltas.length * 0.9)];
  const min = stressDeltas[0];
  const max = stressDeltas[stressDeltas.length - 1];
  
  // Build buckets
  const buckets = buildStressBuckets(stressDeltas, bucketSize);
  
  const stressDelta: StressDelta = { mean, p50, p90, min, max, buckets };
  
  // ─────────────────────────────────────────────────────────────
  // Cascade Rate
  // ─────────────────────────────────────────────────────────────
  
  const cascadeCount = pairs.filter(p => p.cascadeT1).length;
  const cascadeRate = cascadeCount / sampleCount;
  
  // ─────────────────────────────────────────────────────────────
  // Pattern Triggers (patterns at t0 before cascade)
  // ─────────────────────────────────────────────────────────────
  
  const patternCounts = new Map<string, number>();
  const cascadePairs = pairs.filter(p => p.cascadeT1);
  
  for (const pair of cascadePairs) {
    for (const pattern of pair.patternsT0) {
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
    }
  }
  
  const patternTriggersTop: PatternTrigger[] = [];
  const patternKeys = Array.from(patternCounts.keys());
  for (const patternId of patternKeys) {
    const count = patternCounts.get(patternId)!;
    patternTriggersTop.push({
      patternId,
      count,
      pct: Math.round((count / Math.max(1, cascadePairs.length)) * 100),
    });
  }
  patternTriggersTop.sort((a, b) => b.count - a.count);
  
  return {
    regime,
    sampleCount,
    nextRegimeDist,
    regimeChangeRate,
    stressDelta,
    cascadeRate,
    patternTriggersTop: patternTriggersTop.slice(0, 5),
  };
}

function buildStressBuckets(deltas: number[], bucketCount: number): StressBucket[] {
  // Range: -1 to +1
  const bucketSize = 2 / bucketCount;
  const buckets: StressBucket[] = [];
  const counts: number[] = new Array(bucketCount).fill(0);
  
  for (const delta of deltas) {
    // Clamp to -1..+1
    const clamped = Math.max(-1, Math.min(1, delta));
    const bucketIdx = Math.min(
      bucketCount - 1,
      Math.floor((clamped + 1) / bucketSize)
    );
    counts[bucketIdx]++;
  }
  
  for (let i = 0; i < bucketCount; i++) {
    const start = -1 + i * bucketSize;
    const end = start + bucketSize;
    buckets.push({
      bucket: `${start.toFixed(1)}..${end.toFixed(1)}`,
      count: counts[i],
      pct: Math.round((counts[i] / deltas.length) * 100),
    });
  }
  
  return buckets;
}

function generateNotes(
  entries: RegimeForwardEntry[],
  horizon: string
): { interpretation: string[] } {
  const notes: string[] = [];
  
  for (const entry of entries) {
    // High change rate
    if (entry.regimeChangeRate > 0.5) {
      notes.push(
        `${entry.regime} has high transition rate (${(entry.regimeChangeRate * 100).toFixed(0)}%) within ${horizon}`
      );
    }
    
    // Low change rate (stable)
    if (entry.regimeChangeRate < 0.2 && entry.sampleCount >= 20) {
      notes.push(
        `${entry.regime} is stable (${((1 - entry.regimeChangeRate) * 100).toFixed(0)}% persist) over ${horizon}`
      );
    }
    
    // High cascade rate
    if (entry.cascadeRate > 0.15) {
      notes.push(
        `${entry.regime} has elevated cascade risk (${(entry.cascadeRate * 100).toFixed(1)}%)`
      );
    }
    
    // Low cascade rate
    if (entry.cascadeRate < 0.05 && entry.sampleCount >= 20) {
      notes.push(
        `${entry.regime} has low cascade rate (${(entry.cascadeRate * 100).toFixed(1)}%)`
      );
    }
    
    // Stress changes
    if (Math.abs(entry.stressDelta.mean) > 0.15) {
      const direction = entry.stressDelta.mean > 0 ? 'increases' : 'decreases';
      notes.push(
        `${entry.regime} typically ${direction} stress (avg ${entry.stressDelta.mean > 0 ? '+' : ''}${entry.stressDelta.mean.toFixed(2)})`
      );
    }
  }
  
  // Limit to top 5 notes
  return { interpretation: notes.slice(0, 5) };
}

// ═══════════════════════════════════════════════════════════════
// ENSURE INDEXES
// ═══════════════════════════════════════════════════════════════

export async function ensureLabsIndexes(): Promise<void> {
  try {
    const coll = await getCollection();
    
    // Index for time-based queries
    await coll.createIndex(
      { symbol: 1, timestamp: 1 },
      { name: 'labs_symbol_timestamp' }
    );
    
    // Index for regime queries
    await coll.createIndex(
      { symbol: 1, 'regime.type': 1, timestamp: 1 },
      { name: 'labs_regime_time' }
    );
    
    // Index for indicator coverage filter
    await coll.createIndex(
      { symbol: 1, 'indicatorsMeta.completeness': -1, timestamp: 1 },
      { name: 'labs_indicator_coverage' }
    );
    
    console.log('[S10.LABS] MongoDB indexes ensured');
  } catch (error) {
    console.error('[S10.LABS] Failed to create indexes:', error);
  }
}

console.log('[S10.LABS-01] Regime Forward Service loaded');
