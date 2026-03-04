/**
 * S10.6I.6 — Exchange Observation Builder
 * 
 * Assembles a complete ObservationRow from all S10 modules.
 * NO calculations here — only assembly.
 */

import { v4 as uuidv4 } from 'uuid';
import { 
  ExchangeObservationRow, 
  ObservationPatternSummary,
  CreateObservationInput,
  StoredIndicatorValue,
  IndicatorsMeta,
  RegimeType,
  WhaleMeta,
} from './observation.types.js';
import { ExchangePattern } from '../patterns/pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// BUILD INPUT
// ═══════════════════════════════════════════════════════════════

export interface BuildObservationInput {
  symbol: string;
  timestamp?: number;
  
  market?: {
    price: number;
    priceChange5m?: number;
    priceChange15m?: number;
    volatility?: number;
  };
  
  volume?: {
    total: number;
    delta?: number;
    ratio?: number;
  };
  
  openInterest?: {
    value: number;
    delta?: number;
    deltaPct?: number;
  };
  
  orderFlow?: {
    aggressorBias: 'BUY' | 'SELL' | 'NEUTRAL';
    dominance?: number;
    absorption?: boolean;
    absorptionSide?: 'BID' | 'ASK' | null;
    imbalance?: number;
  };
  
  liquidations?: {
    longVolume?: number;
    shortVolume?: number;
    cascadeActive?: boolean;
    cascadeDirection?: 'LONG' | 'SHORT' | null;
    cascadePhase?: string | null;
  };
  
  regime?: {
    type: RegimeType;
    confidence?: number;
  };
  
  patterns?: ExchangePattern[];
  
  // S10.6I — Indicators
  indicators?: Record<string, StoredIndicatorValue>;
  indicatorsMeta?: IndicatorsMeta;
  
  // S10.W — Whale Intelligence (Step 4)
  whaleMeta?: WhaleMeta;
  
  source?: 'polling' | 'replay' | 'manual';
}

// ═══════════════════════════════════════════════════════════════
// PATTERN CONVERTER
// ═══════════════════════════════════════════════════════════════

function convertPatternsToSummary(patterns: ExchangePattern[]): ObservationPatternSummary[] {
  return patterns.map(p => ({
    patternId: p.id,
    name: p.name,
    category: p.category,
    direction: p.direction,
    strength: p.strength,
    confidence: p.confidence,
  }));
}

// ═══════════════════════════════════════════════════════════════
// BUILD OBSERVATION
// ═══════════════════════════════════════════════════════════════

export function buildObservation(input: BuildObservationInput): ExchangeObservationRow {
  const now = Date.now();
  const patterns = input.patterns || [];
  const patternSummaries = convertPatternsToSummary(patterns);
  
  // Count pattern types
  let bullishPatterns = 0;
  let bearishPatterns = 0;
  let neutralPatterns = 0;
  
  for (const pattern of patterns) {
    if (pattern.direction === 'BULLISH') bullishPatterns++;
    else if (pattern.direction === 'BEARISH') bearishPatterns++;
    else neutralPatterns++;
  }
  
  // Check for conflicts
  const hasConflict = bullishPatterns > 0 && bearishPatterns > 0;
  
  // Default indicators meta if not provided
  const defaultIndicatorsMeta: IndicatorsMeta = {
    completeness: 0,
    indicatorCount: 0,
    missing: [],
    source: input.source || 'polling',
  };
  
  const observation: ExchangeObservationRow = {
    id: uuidv4(),
    symbol: input.symbol.toUpperCase(),
    timestamp: input.timestamp || now,
    
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
    
    patterns: patternSummaries,
    patternCount: patterns.length,
    hasConflict,
    bullishPatterns,
    bearishPatterns,
    neutralPatterns,
    
    // S10.6I — Indicators
    indicators: input.indicators || {},
    indicatorsMeta: input.indicatorsMeta || defaultIndicatorsMeta,
    
    // S10.W — Whale Intelligence (Step 4)
    whaleMeta: input.whaleMeta,
    
    createdAt: now,
    source: input.source || 'polling',
  };
  
  return observation;
}

// ═══════════════════════════════════════════════════════════════
// SHOULD SAVE OBSERVATION (rate limiting / significance check)
// ═══════════════════════════════════════════════════════════════

export interface SaveDecision {
  shouldSave: boolean;
  reason: string;
}

const lastSaveTimestamp: Map<string, number> = new Map();
const lastRegime: Map<string, RegimeType> = new Map();
const lastPatternCount: Map<string, number> = new Map();

const MIN_INTERVAL_MS = 60000; // 1 minute between observations

export function shouldSaveObservation(
  observation: ExchangeObservationRow,
  forceReason?: string
): SaveDecision {
  const symbol = observation.symbol;
  const now = Date.now();
  
  // Force save (replay, manual)
  if (forceReason) {
    return { shouldSave: true, reason: forceReason };
  }
  
  // First observation for symbol
  if (!lastSaveTimestamp.has(symbol)) {
    return { shouldSave: true, reason: 'first_observation' };
  }
  
  const lastTs = lastSaveTimestamp.get(symbol)!;
  const elapsed = now - lastTs;
  
  // Regime change
  const prevRegime = lastRegime.get(symbol);
  if (prevRegime && prevRegime !== observation.regime.type) {
    return { shouldSave: true, reason: 'regime_change' };
  }
  
  // Pattern appeared/disappeared
  const prevPatternCount = lastPatternCount.get(symbol) || 0;
  if (observation.patternCount !== prevPatternCount) {
    return { shouldSave: true, reason: 'pattern_change' };
  }
  
  // Cascade started
  if (observation.liquidations.cascadeActive) {
    return { shouldSave: true, reason: 'cascade_active' };
  }
  
  // S10.W Step 4: Whale event (significant whale activity)
  if (observation.whaleMeta) {
    const cpi = observation.indicators?.['contrarian_pressure_index']?.value;
    // Save if CPI is high (whale squeeze risk)
    if (cpi !== undefined && cpi > 0.7) {
      return { shouldSave: true, reason: 'whale_high_cpi' };
    }
  }
  
  // Time-based (rate limit)
  if (elapsed >= MIN_INTERVAL_MS) {
    return { shouldSave: true, reason: 'interval' };
  }
  
  return { shouldSave: false, reason: 'rate_limited' };
}

export function markObservationSaved(observation: ExchangeObservationRow): void {
  lastSaveTimestamp.set(observation.symbol, observation.timestamp);
  lastRegime.set(observation.symbol, observation.regime.type);
  lastPatternCount.set(observation.symbol, observation.patternCount);
}

console.log('[S10.6I.6] Exchange Observation Builder loaded');
