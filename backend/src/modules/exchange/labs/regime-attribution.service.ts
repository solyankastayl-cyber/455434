/**
 * S10.LABS-02 — Indicator → Regime Attribution Service
 * 
 * Analyzes WHY regime changed, not WHAT to do.
 * 
 * RULES:
 * - Indicators are MEASUREMENTS, not causes
 * - Attribution ≠ correlation
 * - Only indicator-driven regimes
 * - NO price, NO pnl, NO predictions
 */

import { MongoClient, Db, Collection } from 'mongodb';
import {
  Horizon,
  Window,
  HORIZON_MS,
  HORIZON_MS_MOCK,
  WINDOW_MS,
} from './labs.types.js';
import { RegimeType, ExchangeObservationRow, StoredIndicatorValue } from '../observation/observation.types.js';
import { IndicatorCategory } from '../indicators/indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface AttributionQuery {
  symbol: string;
  fromRegime?: RegimeType;
  toRegime?: RegimeType;
  horizon: Horizon;
  window: Window;
  indicatorCategory?: IndicatorCategory;
  minSamples: number;
}

export interface IndicatorDelta {
  indicator: string;
  category: IndicatorCategory;
  meanDelta: number;
  medianDelta: number;
  stdDelta: number;
  minDelta: number;
  maxDelta: number;
  sampleCount: number;
  attributionScore: number; // 0..1 normalized
}

export interface TransitionAttribution {
  from: RegimeType;
  to: RegimeType;
  samples: number;
  topDrivers: IndicatorDelta[];
  weakDrivers: IndicatorDelta[];
  allIndicators: IndicatorDelta[];
  notes: string[];
}

export interface AttributionResponse {
  ok: boolean;
  meta: {
    symbol: string;
    horizon: Horizon;
    window: Window;
    indicatorCategory: string | null;
    generatedAt: string;
  };
  totals: {
    observations: number;
    transitionPairs: number;
    uniqueTransitions: number;
  };
  transitions: TransitionAttribution[];
}

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
  
  return collection;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export async function calculateRegimeAttribution(
  query: AttributionQuery
): Promise<AttributionResponse> {
  const coll = await getCollection();
  
  const now = Date.now();
  const windowMs = WINDOW_MS[query.window];
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
  
  const totalObservations = observations.length;
  
  // Detect if mock data
  let isMockData = false;
  if (observations.length >= 2) {
    const avgGap = (observations[observations.length - 1].timestamp - observations[0].timestamp) 
                   / (observations.length - 1);
    isMockData = avgGap < 1000;
  }
  
  const horizonMs = isMockData ? HORIZON_MS_MOCK[query.horizon] : HORIZON_MS[query.horizon];
  
  // ─────────────────────────────────────────────────────────────
  // Step 2: Build transition pairs (regime changed)
  // ─────────────────────────────────────────────────────────────
  
  interface TransitionPair {
    t0: ExchangeObservationRow;
    t1: ExchangeObservationRow;
    from: RegimeType;
    to: RegimeType;
    indicatorDeltas: Map<string, number>;
  }
  
  const transitionPairs: TransitionPair[] = [];
  
  for (let i = 0; i < observations.length; i++) {
    const t0 = observations[i];
    const targetTs = t0.timestamp + horizonMs;
    
    // Find t1: first observation >= targetTs
    let t1: ExchangeObservationRow | null = null;
    for (let j = i + 1; j < observations.length; j++) {
      if (observations[j].timestamp >= targetTs) {
        t1 = observations[j];
        break;
      }
    }
    
    if (!t1) continue;
    
    const fromRegime = t0.regime?.type || 'NEUTRAL';
    const toRegime = t1.regime?.type || 'NEUTRAL';
    
    // Only include transitions (regime changed)
    if (fromRegime === toRegime) continue;
    
    // Filter by specific transition if requested
    if (query.fromRegime && fromRegime !== query.fromRegime) continue;
    if (query.toRegime && toRegime !== query.toRegime) continue;
    
    // Calculate indicator deltas
    const indicatorDeltas = new Map<string, number>();
    const indicators0 = t0.indicators || {};
    const indicators1 = t1.indicators || {};
    
    // Get all indicator keys
    const allIndicatorKeys = new Set([
      ...Object.keys(indicators0),
      ...Object.keys(indicators1),
    ]);
    
    for (const key of allIndicatorKeys) {
      // Filter by category if requested
      if (query.indicatorCategory) {
        const category = indicators0[key]?.category || indicators1[key]?.category;
        if (category !== query.indicatorCategory) continue;
      }
      
      const v0 = indicators0[key]?.value ?? 0;
      const v1 = indicators1[key]?.value ?? 0;
      const delta = v1 - v0;
      
      indicatorDeltas.set(key, delta);
    }
    
    transitionPairs.push({
      t0,
      t1,
      from: fromRegime,
      to: toRegime,
      indicatorDeltas,
    });
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 3: Group by transition type
  // ─────────────────────────────────────────────────────────────
  
  const transitionGroups = new Map<string, TransitionPair[]>();
  
  for (const pair of transitionPairs) {
    const key = `${pair.from}->${pair.to}`;
    if (!transitionGroups.has(key)) {
      transitionGroups.set(key, []);
    }
    transitionGroups.get(key)!.push(pair);
  }
  
  // ─────────────────────────────────────────────────────────────
  // Step 4: Calculate attribution for each transition
  // ─────────────────────────────────────────────────────────────
  
  const transitions: TransitionAttribution[] = [];
  
  const groupKeys = Array.from(transitionGroups.keys());
  for (const key of groupKeys) {
    const pairs = transitionGroups.get(key)!;
    
    if (pairs.length < query.minSamples) continue;
    
    const [from, to] = key.split('->') as [RegimeType, RegimeType];
    const attribution = calculateTransitionAttribution(from, to, pairs);
    transitions.push(attribution);
  }
  
  // Sort by sample count
  transitions.sort((a, b) => b.samples - a.samples);
  
  // ─────────────────────────────────────────────────────────────
  // Step 5: Build response
  // ─────────────────────────────────────────────────────────────
  
  return {
    ok: true,
    meta: {
      symbol: query.symbol.toUpperCase(),
      horizon: query.horizon,
      window: query.window,
      indicatorCategory: query.indicatorCategory || null,
      generatedAt: new Date().toISOString(),
    },
    totals: {
      observations: totalObservations,
      transitionPairs: transitionPairs.length,
      uniqueTransitions: transitions.length,
    },
    transitions,
  };
}

// ═══════════════════════════════════════════════════════════════
// ATTRIBUTION CALCULATION
// ═══════════════════════════════════════════════════════════════

function calculateTransitionAttribution(
  from: RegimeType,
  to: RegimeType,
  pairs: Array<{ indicatorDeltas: Map<string, number> }>
): TransitionAttribution {
  const samples = pairs.length;
  
  // Aggregate deltas by indicator
  const indicatorStats = new Map<string, number[]>();
  
  for (const pair of pairs) {
    const keys = Array.from(pair.indicatorDeltas.keys());
    for (const key of keys) {
      if (!indicatorStats.has(key)) {
        indicatorStats.set(key, []);
      }
      indicatorStats.get(key)!.push(pair.indicatorDeltas.get(key)!);
    }
  }
  
  // Calculate statistics for each indicator
  const allIndicators: IndicatorDelta[] = [];
  
  const indicatorKeys = Array.from(indicatorStats.keys());
  for (const indicator of indicatorKeys) {
    const deltas = indicatorStats.get(indicator)!;
    if (deltas.length < 3) continue; // Need minimum samples
    
    const stats = calculateStats(deltas);
    
    // Attribution score: |meanDelta| × consistency × frequency
    // Consistency = 1 - (std / max(|deltas|))
    const maxAbs = Math.max(...deltas.map(d => Math.abs(d)));
    const consistency = maxAbs > 0 ? 1 - Math.min(1, stats.std / maxAbs) : 0;
    const frequency = deltas.length / samples;
    
    const attributionScore = Math.min(1, Math.abs(stats.mean) * consistency * frequency * 2);
    
    // Determine category from indicator name
    const category = getIndicatorCategory(indicator);
    
    allIndicators.push({
      indicator,
      category,
      meanDelta: stats.mean,
      medianDelta: stats.median,
      stdDelta: stats.std,
      minDelta: stats.min,
      maxDelta: stats.max,
      sampleCount: deltas.length,
      attributionScore,
    });
  }
  
  // Sort by attribution score
  allIndicators.sort((a, b) => b.attributionScore - a.attributionScore);
  
  // Split into top drivers (score >= 0.3) and weak drivers (score < 0.3)
  const topDrivers = allIndicators.filter(i => i.attributionScore >= 0.3).slice(0, 5);
  const weakDrivers = allIndicators.filter(i => i.attributionScore < 0.3 && i.attributionScore > 0.1).slice(0, 3);
  
  // Generate notes
  const notes = generateAttributionNotes(from, to, topDrivers);
  
  return {
    from,
    to,
    samples,
    topDrivers,
    weakDrivers,
    allIndicators,
    notes,
  };
}

function calculateStats(values: number[]): {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 === 0 
    ? (sorted[n/2 - 1] + sorted[n/2]) / 2 
    : sorted[Math.floor(n/2)];
  
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  
  return {
    mean,
    median,
    std,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

function getIndicatorCategory(indicator: string): IndicatorCategory {
  // Map indicator names to categories
  const categoryMap: Record<string, IndicatorCategory> = {
    // Price Structure
    'ema_distance_fast': 'PRICE_STRUCTURE',
    'ema_distance_mid': 'PRICE_STRUCTURE',
    'ema_distance_slow': 'PRICE_STRUCTURE',
    'vwap_deviation': 'PRICE_STRUCTURE',
    'median_price_deviation': 'PRICE_STRUCTURE',
    'atr_normalized': 'PRICE_STRUCTURE',
    'trend_slope': 'PRICE_STRUCTURE',
    'range_compression': 'PRICE_STRUCTURE',
    
    // Momentum
    'rsi_normalized': 'MOMENTUM',
    'stochastic': 'MOMENTUM',
    'macd_delta': 'MOMENTUM',
    'roc': 'MOMENTUM',
    'momentum_decay': 'MOMENTUM',
    'directional_momentum_balance': 'MOMENTUM',
    
    // Volume
    'volume_index': 'VOLUME',
    'volume_delta': 'VOLUME',
    'buy_sell_ratio': 'VOLUME',
    'volume_price_response': 'VOLUME',
    'relative_volume': 'VOLUME',
    'participation_intensity': 'VOLUME',
    
    // Order Book
    'book_imbalance': 'ORDER_BOOK',
    'depth_density': 'ORDER_BOOK',
    'liquidity_walls': 'ORDER_BOOK',
    'absorption_strength': 'ORDER_BOOK',
    'liquidity_vacuum': 'ORDER_BOOK',
    'spread_pressure': 'ORDER_BOOK',
    
    // Positioning
    'oi_level': 'POSITIONING',
    'oi_delta': 'POSITIONING',
    'oi_volume_ratio': 'POSITIONING',
    'funding_pressure': 'POSITIONING',
    'long_short_ratio': 'POSITIONING',
    'position_crowding': 'POSITIONING',
  };
  
  return categoryMap[indicator] || 'PRICE_STRUCTURE';
}

function generateAttributionNotes(
  from: RegimeType,
  to: RegimeType,
  topDrivers: IndicatorDelta[]
): string[] {
  const notes: string[] = [];
  
  if (topDrivers.length === 0) {
    notes.push(`Transition ${from} → ${to} has no clear dominant drivers`);
    return notes;
  }
  
  // Main driver note
  const mainDriver = topDrivers[0];
  const direction = mainDriver.meanDelta > 0 ? 'increased' : 'decreased';
  notes.push(
    `Primary driver: ${mainDriver.indicator.replace(/_/g, ' ')} ${direction} (avg ${mainDriver.meanDelta > 0 ? '+' : ''}${mainDriver.meanDelta.toFixed(2)})`
  );
  
  // Category concentration
  const categories = topDrivers.map(d => d.category);
  const uniqueCategories = new Set(categories);
  if (uniqueCategories.size === 1) {
    notes.push(`All top drivers from ${Array.from(uniqueCategories)[0]} category`);
  }
  
  // Consistency note
  const highConsistency = topDrivers.filter(d => d.stdDelta < Math.abs(d.meanDelta) * 0.5);
  if (highConsistency.length >= 2) {
    notes.push(`${highConsistency.length} indicators show consistent behavior`);
  }
  
  return notes;
}

console.log('[S10.LABS-02] Regime Attribution Service loaded');
