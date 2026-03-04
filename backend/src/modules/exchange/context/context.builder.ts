/**
 * B3 — Market Context Builder Service
 * 
 * Builds MarketContext from:
 * - Indicator aggregates (6 axes)
 * - Regime (indicator-driven)
 * - Patterns
 * - Whale risk context
 * - Universe score
 */

import {
  MarketContext,
  MarketContextDebug,
  MarketAxes,
  MarketAxesDrivers,
  RegimeInfo,
  PatternInfo,
  WhaleRiskInfo,
  ReadinessInfo,
  ReadinessStatus,
} from './context.types.js';
import { computeMarketAggregates, MarketAggregates } from '../indicators/indicator.aggregates.js';
import { getUniverseItem } from '../universe/universe.builder.js';
import * as whaleStorage from '../whales/whale-storage.service.js';
import { detectWhalePatterns } from '../whales/patterns/whale-pattern.detector.js';
import { getDb } from '../../../db/mongodb.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'exchange_market_context';

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

async function getCollection() {
  const db = getDb();
  return db.collection(COLLECTION_NAME);
}

export async function saveContext(ctx: MarketContext): Promise<void> {
  const collection = await getCollection();
  await collection.updateOne(
    { symbol: ctx.symbol },
    { $set: ctx },
    { upsert: true }
  );
}

export async function getContext(symbol: string): Promise<MarketContext | null> {
  const collection = await getCollection();
  return collection.findOne({ symbol }) as Promise<MarketContext | null>;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clamp11(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

// ═══════════════════════════════════════════════════════════════
// GET INDICATORS FROM DB
// ═══════════════════════════════════════════════════════════════

async function getLatestIndicators(symbol: string): Promise<{
  indicators: Record<string, number>;
  timestamp: string;
} | null> {
  try {
    const db = getDb();
    const collection = db.collection('exchange_observations');
    
    const doc = await collection.findOne(
      { symbol },
      { sort: { timestamp: -1 } }
    );
    
    if (!doc || !doc.indicators) return null;
    
    return {
      indicators: doc.indicators,
      timestamp: new Date(doc.timestamp).toISOString(),
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// GET REGIME FROM DB
// ═══════════════════════════════════════════════════════════════

async function getLatestRegime(symbol: string): Promise<RegimeInfo | undefined> {
  try {
    const db = getDb();
    const collection = db.collection('exchange_observations');
    
    const doc = await collection.findOne(
      { symbol },
      { sort: { timestamp: -1 } }
    );
    
    if (!doc) return undefined;
    
    // Try indicator-driven regime first
    if (doc.regimeIndicator) {
      return {
        type: doc.regimeIndicator.type,
        confidence: doc.regimeIndicator.confidence ?? 0.7,
        source: 'indicator',
        drivers: doc.regimeIndicator.drivers ?? [],
      };
    }
    
    // Fall back to legacy
    if (doc.regime) {
      return {
        type: doc.regime,
        confidence: 0.6,
        source: 'legacy',
      };
    }
    
    return undefined;
  } catch (e) {
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════
// GET PATTERNS FROM DB
// ═══════════════════════════════════════════════════════════════

async function getActivePatterns(symbol: string): Promise<PatternInfo[]> {
  try {
    const db = getDb();
    const collection = db.collection('exchange_observations');
    
    const doc = await collection.findOne(
      { symbol },
      { sort: { timestamp: -1 } }
    );
    
    if (!doc?.patternsIndicator) return [];
    
    return doc.patternsIndicator
      .filter((p: any) => p.active)
      .map((p: any) => ({
        id: p.id || p.patternId,
        confidence: p.confidence ?? 0.7,
        stabilityTicks: p.stabilityTicks ?? 1,
      }));
  } catch (e) {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// GET WHALE RISK
// ═══════════════════════════════════════════════════════════════

async function getWhaleRisk(symbol: string): Promise<WhaleRiskInfo> {
  const defaultRisk: WhaleRiskInfo = {
    bucket: 'LOW',
    lift: 1.0,
    activePattern: null,
  };
  
  try {
    // Get whale state
    const state = await whaleStorage.getLatestState('hyperliquid', symbol);
    if (!state) return defaultRisk;
    
    // Get whale patterns
    const patterns = await detectWhalePatterns(symbol);
    const activePattern = patterns.patterns.find(p => p.active && p.riskLevel === 'HIGH');
    
    // Determine bucket from overall risk
    let bucket: 'LOW' | 'MID' | 'HIGH' = 'LOW';
    if (patterns.hasHighRisk) {
      bucket = 'HIGH';
    } else if (patterns.patterns.some(p => p.active && p.riskLevel === 'MEDIUM')) {
      bucket = 'MID';
    }
    
    return {
      bucket,
      lift: 1.0 + (patterns.highestRisk?.riskScore ?? 0) * 0.5,
      activePattern: activePattern?.patternId ?? null,
      netBias: state.netBias,
      maxPositionUsd: state.maxSinglePositionUsd,
    };
  } catch (e) {
    return defaultRisk;
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILD AXES FROM AGGREGATES
// ═══════════════════════════════════════════════════════════════

function buildAxes(agg: MarketAggregates): MarketAxes {
  return {
    momentum: clamp11(agg.momentumState),
    structure: clamp11(agg.structureState),
    participation: clamp01(agg.participation),
    orderbookPressure: clamp11(agg.orderbookPressure),
    positioning: clamp01(agg.positionCrowding),
    marketStress: clamp01(agg.marketStress),
  };
}

function buildDrivers(agg: MarketAggregates): MarketAxesDrivers {
  return {
    momentum: agg.momentumDrivers ?? [],
    structure: agg.structureDrivers ?? [],
    participation: agg.participationDrivers ?? [],
    orderbookPressure: agg.orderbookDrivers ?? [],
    positioning: agg.positioningDrivers ?? [],
    marketStress: agg.stressDrivers ?? [],
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD READINESS
// ═══════════════════════════════════════════════════════════════

function buildReadiness(
  hasIndicators: boolean,
  hasRegime: boolean,
  whaleRisk: WhaleRiskInfo,
  indicatorAge: number
): ReadinessInfo {
  const reasons: string[] = [];
  let score = 1.0;
  
  if (!hasIndicators) {
    reasons.push('INDICATORS_MISSING');
    score -= 0.4;
  }
  
  if (!hasRegime) {
    reasons.push('REGIME_MISSING');
    score -= 0.2;
  }
  
  if (indicatorAge > 60_000) { // > 1 minute
    reasons.push('INDICATORS_STALE');
    score -= 0.15;
  }
  
  if (whaleRisk.bucket === 'HIGH') {
    reasons.push('WHALE_RISK_HIGH');
    // Don't reduce score, just note it
  }
  
  score = clamp01(score);
  
  let status: ReadinessStatus = 'READY';
  if (!hasIndicators) {
    status = 'NO_DATA';
  } else if (score < 0.55) {
    status = 'DEGRADED';
  }
  
  return { status, score, reasons };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: BUILD MARKET CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function buildMarketContext(symbol: string): Promise<MarketContext> {
  const now = new Date();
  
  // Get universe info
  const universeItem = await getUniverseItem(symbol);
  const universeScore = universeItem?.scores.universeScore ?? 0;
  
  // Get indicators
  const indicatorData = await getLatestIndicators(symbol);
  const hasIndicators = indicatorData !== null;
  const indicatorAge = indicatorData
    ? now.getTime() - new Date(indicatorData.timestamp).getTime()
    : Infinity;
  
  // Compute aggregates if we have indicators
  let axes: MarketAxes = {
    momentum: 0,
    structure: 0,
    participation: 0.5,
    orderbookPressure: 0,
    positioning: 0.5,
    marketStress: 0.5,
  };
  let drivers: MarketAxesDrivers = {
    momentum: [],
    structure: [],
    participation: [],
    orderbookPressure: [],
    positioning: [],
    marketStress: [],
  };
  
  if (indicatorData) {
    const agg = computeMarketAggregates(indicatorData.indicators);
    axes = buildAxes(agg);
    drivers = buildDrivers(agg);
  }
  
  // Get regime
  const regime = await getLatestRegime(symbol);
  const hasRegime = regime !== undefined;
  
  // Get patterns
  const patterns = await getActivePatterns(symbol);
  
  // Get whale risk
  const whaleRisk = await getWhaleRisk(symbol);
  
  // Build readiness
  const readiness = buildReadiness(hasIndicators, hasRegime, whaleRisk, indicatorAge);
  
  const context: MarketContext = {
    symbol,
    exchange: 'binance', // TODO: from universe
    
    axes,
    drivers,
    regime,
    patterns,
    whaleRisk,
    readiness,
    
    refs: {
      lastIndicatorsAt: indicatorData?.timestamp,
      lastWhalesAt: whaleRisk.netBias !== undefined ? now.toISOString() : undefined,
    },
    
    universeScore,
    updatedAt: now.toISOString(),
  };
  
  // Save to DB
  await saveContext(context);
  
  return context;
}

// ═══════════════════════════════════════════════════════════════
// BATCH BUILD
// ═══════════════════════════════════════════════════════════════

export async function buildContextBatch(symbols: string[]): Promise<MarketContext[]> {
  const results: MarketContext[] = [];
  
  for (const symbol of symbols) {
    try {
      const ctx = await buildMarketContext(symbol);
      results.push(ctx);
    } catch (e: any) {
      console.warn(`[Context] Failed to build for ${symbol}:`, e.message);
    }
  }
  
  return results;
}

console.log('[B3] Context Builder Service loaded');
