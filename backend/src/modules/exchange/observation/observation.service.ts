/**
 * S10.6 — Observation Service
 * S10.6I.6 — Extended with Indicator Persistence
 * 
 * Orchestrates observation creation from S10.1-S10.5 modules.
 * Called after each exchange tick/polling cycle.
 * 
 * 1 tick = 1 observation (even if patterns = [])
 */

import { v4 as uuid } from 'uuid';
import {
  ExchangeObservationRow,
  ObservationStats,
  ObservationQuery,
  RegimePatternMatrix,
  CreateObservationInput,
  ObservationPatternSummary,
  RegimeType,
  StoredIndicatorValue,
  IndicatorsMeta,
} from './observation.types.js';
import * as storage from './observation.storage.js';
import { ExchangePattern } from '../patterns/pattern.types.js';
import { buildObservation, shouldSaveObservation, markObservationSaved } from './observation.builder.js';
import { buildIndicatorSnapshotForStorage } from '../indicators/indicator.snapshot.js';
import { IndicatorInput, OHLCVCandle } from '../indicators/indicator.types.js';

// ═══════════════════════════════════════════════════════════════
// IN-MEMORY CACHE (recent observations)
// ═══════════════════════════════════════════════════════════════

const recentObservationsCache: Map<string, ExchangeObservationRow[]> = new Map();
const MAX_CACHE_PER_SYMBOL = 100;

// ═══════════════════════════════════════════════════════════════
// CREATE OBSERVATION (LEGACY — still works)
// ═══════════════════════════════════════════════════════════════

export async function createObservation(input: CreateObservationInput): Promise<ExchangeObservationRow> {
  const now = Date.now();
  const symbol = input.symbol.toUpperCase();
  
  // Convert patterns to summary format
  const patterns: ObservationPatternSummary[] = (input.patterns || []).map(p => ({
    patternId: p.patternId,
    name: p.name,
    category: p.category,
    direction: p.direction,
    strength: p.strength,
    confidence: p.confidence,
  }));
  
  // Count directions
  const bullishPatterns = patterns.filter(p => p.direction === 'BULLISH').length;
  const bearishPatterns = patterns.filter(p => p.direction === 'BEARISH').length;
  const neutralPatterns = patterns.filter(p => p.direction === 'NEUTRAL').length;
  const hasConflict = bullishPatterns > 0 && bearishPatterns > 0;
  
  // Default indicators (empty for legacy calls)
  const defaultIndicatorsMeta: IndicatorsMeta = {
    completeness: 0,
    indicatorCount: 0,
    missing: [],
    source: 'polling',
  };
  
  // Build observation row
  const row: ExchangeObservationRow = {
    id: uuid(),
    symbol,
    timestamp: now,
    
    market: {
      price: input.market?.price || 0,
      priceChange5m: input.market?.priceChange5m || 0,
      priceChange15m: input.market?.priceChange15m || 0,
      volatility: input.market?.volatility || 0,
    },
    
    volume: {
      total: input.volume?.total || 0,
      delta: input.volume?.delta || 0,
      ratio: input.volume?.ratio || 1,
    },
    
    openInterest: {
      value: input.openInterest?.value || 0,
      delta: input.openInterest?.delta || 0,
      deltaPct: input.openInterest?.deltaPct || 0,
    },
    
    orderFlow: {
      aggressorBias: input.orderFlow?.aggressorBias || 'NEUTRAL',
      dominance: input.orderFlow?.dominance || 0.5,
      absorption: input.orderFlow?.absorption || false,
      absorptionSide: input.orderFlow?.absorptionSide || null,
      imbalance: input.orderFlow?.imbalance || 0,
    },
    
    liquidations: {
      longVolume: input.liquidations?.longVolume || 0,
      shortVolume: input.liquidations?.shortVolume || 0,
      cascadeActive: input.liquidations?.cascadeActive || false,
      cascadeDirection: input.liquidations?.cascadeDirection || null,
      cascadePhase: input.liquidations?.cascadePhase || null,
    },
    
    regime: {
      type: input.regime?.type || 'NEUTRAL',
      confidence: input.regime?.confidence || 0,
    },
    
    patterns,
    patternCount: patterns.length,
    hasConflict,
    bullishPatterns,
    bearishPatterns,
    neutralPatterns,
    
    // S10.6I — Indicators (empty for legacy)
    indicators: {},
    indicatorsMeta: defaultIndicatorsMeta,
    
    createdAt: now,
    source: 'polling',
  };
  
  // Save to MongoDB
  await storage.saveObservation(row);
  
  // Update cache
  updateCache(symbol, row);
  
  return row;
}

// ═══════════════════════════════════════════════════════════════
// CREATE OBSERVATION WITH INDICATORS (S10.6I.6)
// ═══════════════════════════════════════════════════════════════

export interface CreateObservationWithIndicatorsInput extends CreateObservationInput {
  candles?: OHLCVCandle[];
  source?: 'polling' | 'replay' | 'manual';
  forceReason?: string;
}

export async function createObservationWithIndicators(
  input: CreateObservationWithIndicatorsInput
): Promise<ExchangeObservationRow | null> {
  const symbol = input.symbol.toUpperCase();
  const now = Date.now();
  
  // Build indicator input
  const indicatorInput: IndicatorInput = {
    symbol,
    candles: input.candles || generateMockCandles(symbol, 100),
    price: input.market?.price || 0,
    volume: input.volume ? {
      total: input.volume.total,
      buy: input.volume.total * 0.5,
      sell: input.volume.total * 0.5,
    } : undefined,
    openInterest: input.openInterest ? {
      value: input.openInterest.value,
      delta: input.openInterest.delta || 0,
    } : undefined,
  };
  
  // Calculate indicators
  const indicatorSnapshot = buildIndicatorSnapshotForStorage(
    indicatorInput,
    input.source || 'polling'
  );
  
  // Build observation
  const observation = buildObservation({
    ...input,
    symbol,
    timestamp: now,
    indicators: indicatorSnapshot.indicators,
    indicatorsMeta: indicatorSnapshot.meta,
    source: input.source || 'polling',
  });
  
  // Check if should save
  const saveDecision = shouldSaveObservation(observation, input.forceReason);
  
  if (!saveDecision.shouldSave) {
    return null; // Rate limited
  }
  
  // Save to MongoDB
  await storage.saveObservation(observation);
  
  // Mark saved
  markObservationSaved(observation);
  
  // Update cache
  updateCache(symbol, observation);
  
  console.log(`[S10.6I.6] Saved observation for ${symbol}: ${indicatorSnapshot.meta.indicatorCount}/32 indicators (${saveDecision.reason})`);
  
  return observation;
}

// ═══════════════════════════════════════════════════════════════
// GET OBSERVATIONS
// ═══════════════════════════════════════════════════════════════

export async function getObservations(query: ObservationQuery): Promise<ExchangeObservationRow[]> {
  return storage.getObservations(query);
}

export async function getRecentObservations(
  symbol?: string,
  limit: number = 50
): Promise<ExchangeObservationRow[]> {
  // Try cache first for single symbol
  if (symbol) {
    const cached = recentObservationsCache.get(symbol.toUpperCase());
    if (cached && cached.length >= limit) {
      return cached.slice(0, limit);
    }
  }
  
  // Fallback to storage
  return storage.getRecentObservations(symbol, limit);
}

// ═══════════════════════════════════════════════════════════════
// GET STATS
// ═══════════════════════════════════════════════════════════════

export async function getStats(): Promise<ObservationStats> {
  return storage.getStats();
}

// ═══════════════════════════════════════════════════════════════
// GET REGIME × PATTERN MATRIX
// ═══════════════════════════════════════════════════════════════

export async function getRegimePatternMatrix(): Promise<RegimePatternMatrix> {
  return storage.getRegimePatternMatrix();
}

// ═══════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export async function clearObservations(symbol?: string): Promise<number> {
  const count = await storage.clearObservations(symbol);
  
  if (symbol) {
    recentObservationsCache.delete(symbol.toUpperCase());
  } else {
    recentObservationsCache.clear();
  }
  
  return count;
}

export async function getCount(symbol?: string): Promise<number> {
  return storage.getCount(symbol);
}

// ═══════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function updateCache(symbol: string, row: ExchangeObservationRow): void {
  if (!recentObservationsCache.has(symbol)) {
    recentObservationsCache.set(symbol, []);
  }
  
  const cache = recentObservationsCache.get(symbol)!;
  cache.unshift(row);
  
  // Trim cache
  while (cache.length > MAX_CACHE_PER_SYMBOL) {
    cache.pop();
  }
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATOR (for testing)
// ═══════════════════════════════════════════════════════════════

function generateMockCandles(symbol: string, count: number = 100): OHLCVCandle[] {
  const now = Date.now();
  const candles: OHLCVCandle[] = [];
  
  const seed = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const basePrice = symbol === 'BTCUSDT' ? 95000 : symbol === 'ETHUSDT' ? 3500 : 100;
  let price = basePrice;
  
  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * 60000;
    const change = (Math.sin(i * 0.1 + seed) * 0.02 + (Math.random() - 0.5) * 0.01) * price;
    price += change;
    
    const high = price * (1 + Math.random() * 0.005);
    const low = price * (1 - Math.random() * 0.005);
    const open = low + Math.random() * (high - low);
    const close = low + Math.random() * (high - low);
    const volume = 100 + Math.random() * 1000;
    
    candles.push({ timestamp, open, high, low, close, volume });
  }
  
  return candles;
}

export function generateMockObservationInput(symbol: string): CreateObservationInput {
  const rand = () => Math.random();
  const randChoice = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  
  const basePrice = symbol === 'BTCUSDT' ? 95000 : symbol === 'ETHUSDT' ? 3500 : 100;
  
  return {
    symbol,
    
    market: {
      price: basePrice + (rand() - 0.5) * basePrice * 0.05,
      priceChange5m: (rand() - 0.5) * 2,
      priceChange15m: (rand() - 0.5) * 4,
      volatility: rand() * 0.05,
    },
    
    volume: {
      total: 1000000 + rand() * 5000000,
      delta: (rand() - 0.3) * 30,
      ratio: 0.5 + rand() * 2,
    },
    
    openInterest: {
      value: 50000000 + rand() * 100000000,
      delta: (rand() - 0.4) * 10000000,
      deltaPct: (rand() - 0.4) * 15,
    },
    
    orderFlow: {
      aggressorBias: randChoice(['BUY', 'SELL', 'NEUTRAL']),
      dominance: 0.3 + rand() * 0.5,
      absorption: rand() > 0.6,
      absorptionSide: rand() > 0.5 ? 'BID' : 'ASK',
      imbalance: (rand() - 0.5) * 2,
    },
    
    liquidations: {
      longVolume: rand() * 500000,
      shortVolume: rand() * 500000,
      cascadeActive: rand() > 0.8,
      cascadeDirection: rand() > 0.5 ? 'LONG' : 'SHORT',
      cascadePhase: randChoice(['START', 'ACTIVE', 'PEAK', 'DECAY', 'END', null]),
    },
    
    regime: {
      type: randChoice(['ACCUMULATION', 'DISTRIBUTION', 'EXPANSION', 'EXHAUSTION', 'NEUTRAL', 'LONG_SQUEEZE', 'SHORT_SQUEEZE']) as RegimeType,
      confidence: 0.4 + rand() * 0.5,
    },
    
    // Patterns will be added by the caller
    patterns: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// BACKFILL API (S10.6I.6)
// ═══════════════════════════════════════════════════════════════

export async function backfillObservations(
  symbol: string,
  count: number = 10
): Promise<ExchangeObservationRow[]> {
  const results: ExchangeObservationRow[] = [];
  
  for (let i = 0; i < count; i++) {
    const mockInput = generateMockObservationInput(symbol);
    const observation = await createObservationWithIndicators({
      ...mockInput,
      source: 'replay',
      forceReason: 'backfill',
    });
    
    if (observation) {
      results.push(observation);
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`[S10.6I.6] Backfilled ${results.length} observations for ${symbol}`);
  return results;
}

// ═══════════════════════════════════════════════════════════════
// GET OBSERVATION WITH INDICATORS
// ═══════════════════════════════════════════════════════════════

export async function getObservationById(id: string): Promise<ExchangeObservationRow | null> {
  return storage.getObservationById(id);
}

export async function getLatestObservation(symbol: string): Promise<ExchangeObservationRow | null> {
  const recent = await getRecentObservations(symbol, 1);
  return recent.length > 0 ? recent[0] : null;
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR STATS
// ═══════════════════════════════════════════════════════════════

export interface IndicatorCoverageStats {
  totalObservations: number;
  withIndicators: number;
  coverageRate: number;
  avgCompleteness: number;
  avgIndicatorCount: number;
}

export async function getIndicatorCoverageStats(symbol?: string): Promise<IndicatorCoverageStats> {
  return storage.getIndicatorCoverageStats(symbol);
}

console.log('[S10.6] Observation Service initialized (S10.6I.6 enabled)');
