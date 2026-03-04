/**
 * S10.3 — Regime Service
 * S10.6I.7 — Extended with Indicator-driven detection
 * 
 * Orchestrates regime detection and maintains history.
 * Now supports DUAL COMPUTE: legacy + indicator-driven.
 */

import {
  MarketRegime,
  MarketRegimeState,
  RegimeMetrics,
  RegimeHistoryEntry,
  RegimeDiagnostics,
  RegimeThresholds,
  DEFAULT_THRESHOLDS,
} from './regime.types.js';
import { detectMarketRegime, getPriceDirection, getAlternativeRegimes } from './regime.detector.js';
import { detectIndicatorDrivenRegime, IndicatorDrivenRegime } from './regime.indicator-detector.js';
import * as exchangeDataService from '../exchange-data.service.js';
import * as orderFlowService from '../order-flow/order-flow.service.js';
import { StoredIndicatorValue } from '../observation/observation.types.js';
import { getIndicatorSnapshot } from '../indicators/indicator.service.js';

// Caches
const regimeCache: Map<string, MarketRegimeState> = new Map();
const regimeHistory: Map<string, RegimeHistoryEntry[]> = new Map();
const priceBaseline: Map<string, number[]> = new Map();
const volumeBaseline: Map<string, number[]> = new Map();

const MAX_HISTORY_LENGTH = 50;
const BASELINE_WINDOW = 10; // Number of samples for baseline

/**
 * Calculate average from array
 */
function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Update baseline for a metric
 */
function updateBaseline(cache: Map<string, number[]>, symbol: string, value: number): number {
  const history = cache.get(symbol) || [];
  history.push(value);
  if (history.length > BASELINE_WINDOW) {
    history.shift();
  }
  cache.set(symbol, history);
  return avg(history.slice(0, -1)); // Baseline excludes current
}

/**
 * Detect regime for a symbol (LEGACY - still works)
 */
export function detectRegime(symbol: string): MarketRegimeState {
  const now = new Date();
  
  // Get current data from S10.1
  const markets = exchangeDataService.getMarkets();
  const market = markets.find(m => m.symbol === symbol);
  const oi = exchangeDataService.getOpenInterest(symbol);
  const overview = exchangeDataService.getOverview();
  
  // Get order flow from S10.2
  const flowSummary = orderFlowService.getOrderFlowSummary(symbol);
  
  // Calculate metrics
  const currentPrice = market?.price || 0;
  const currentVolume = market?.volume24h || 0;
  const currentOI = oi?.oi || 0;
  
  // Update baselines
  const baselinePrice = updateBaseline(priceBaseline, symbol, currentPrice);
  const baselineVolume = updateBaseline(volumeBaseline, symbol, currentVolume);
  
  // Calculate deltas
  const priceDelta = baselinePrice > 0 
    ? ((currentPrice - baselinePrice) / baselinePrice) * 100 
    : 0;
  const volumeDelta = baselineVolume > 0 
    ? ((currentVolume - baselineVolume) / baselineVolume) * 100 
    : 0;
  const oiDelta = oi?.oiChange || 0;
  
  // Build metrics object
  const metrics: RegimeMetrics = {
    volumeDelta,
    oiDelta,
    priceDelta,
    priceDirection: getPriceDirection(priceDelta),
    orderFlowBias: flowSummary.marketBias,
    absorptionActive: flowSummary.absorption.detected,
    liquidationPressure: overview.liquidationPressure,
  };
  
  // Detect regime
  const detection = detectMarketRegime(metrics);
  
  const state: MarketRegimeState = {
    symbol,
    regime: detection.regime,
    confidence: detection.confidence,
    drivers: detection.drivers,
    metrics,
    timestamp: now,
  };
  
  // Update cache and history
  updateRegimeHistory(symbol, state);
  regimeCache.set(symbol, state);
  
  return state;
}

// ═══════════════════════════════════════════════════════════════
// S10.6I.7 — INDICATOR-DRIVEN REGIME DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect regime using ONLY indicators (S10.6I.7)
 */
export function detectRegimeFromIndicators(
  symbol: string,
  indicators?: Record<string, StoredIndicatorValue>
): IndicatorDrivenRegime {
  // If indicators not provided, fetch from indicator service
  let indicatorMap = indicators;
  
  if (!indicatorMap) {
    const snapshot = getIndicatorSnapshot(symbol);
    indicatorMap = {};
    for (const ind of snapshot.indicators) {
      indicatorMap[ind.id] = {
        value: ind.value,
        category: ind.category,
        normalized: ind.normalized,
      };
    }
  }
  
  return detectIndicatorDrivenRegime(indicatorMap);
}

/**
 * Dual compute: legacy + indicator-driven (S10.6I.7)
 */
export interface DualRegimeResult {
  legacy: MarketRegimeState;
  indicatorDriven: IndicatorDrivenRegime;
  diff: {
    sameType: boolean;
    confidenceDelta: number;
    legacyDrivers: string[];
    indicatorDrivers: string[];
  };
}

export function detectRegimeDual(
  symbol: string,
  indicators?: Record<string, StoredIndicatorValue>
): DualRegimeResult {
  const legacy = detectRegime(symbol);
  const indicatorDriven = detectRegimeFromIndicators(symbol, indicators);
  
  return {
    legacy,
    indicatorDriven,
    diff: {
      sameType: legacy.regime === indicatorDriven.regime,
      confidenceDelta: Math.abs(legacy.confidence - indicatorDriven.confidence),
      legacyDrivers: legacy.drivers,
      indicatorDrivers: indicatorDriven.drivers,
    },
  };
}

/**
 * Update regime history
 */
function updateRegimeHistory(symbol: string, newState: MarketRegimeState): void {
  const history = regimeHistory.get(symbol) || [];
  const lastEntry = history[history.length - 1];
  
  if (lastEntry && lastEntry.regime === newState.regime && lastEntry.endedAt === null) {
    // Same regime, extend duration
    // (entry will be closed when regime changes)
  } else {
    // New regime or first entry
    if (lastEntry && lastEntry.endedAt === null) {
      // Close previous entry
      lastEntry.endedAt = newState.timestamp;
      lastEntry.duration = newState.timestamp.getTime() - lastEntry.startedAt.getTime();
    }
    
    // Add new entry
    history.push({
      regime: newState.regime,
      confidence: newState.confidence,
      duration: 0,
      startedAt: newState.timestamp,
      endedAt: null,
    });
    
    // Limit history size
    if (history.length > MAX_HISTORY_LENGTH) {
      history.shift();
    }
  }
  
  regimeHistory.set(symbol, history);
}

/**
 * Get current regime state
 */
export function getRegimeState(symbol: string): MarketRegimeState | null {
  // Always recalculate for fresh data
  return detectRegime(symbol);
}

/**
 * Get regime history
 */
export function getRegimeHistory(symbol: string, limit: number = 20): RegimeHistoryEntry[] {
  const history = regimeHistory.get(symbol) || [];
  return history.slice(-limit);
}

/**
 * Get diagnostics for admin
 */
export function getDiagnostics(symbol: string): RegimeDiagnostics {
  const state = detectRegime(symbol);
  const history = getRegimeHistory(symbol);
  
  // Get raw data
  const markets = exchangeDataService.getMarkets();
  const market = markets.find(m => m.symbol === symbol);
  const oi = exchangeDataService.getOpenInterest(symbol);
  
  const currentPrice = market?.price || 0;
  const currentVolume = market?.volume24h || 0;
  const currentOI = oi?.oi || 0;
  
  const priceHist = priceBaseline.get(symbol) || [];
  const volumeHist = volumeBaseline.get(symbol) || [];
  
  const previousPrice = priceHist.length > 1 ? priceHist[priceHist.length - 2] : currentPrice;
  const baselineVolume = avg(volumeHist.slice(0, -1));
  
  return {
    symbol,
    currentRegime: state,
    rawInputs: {
      currentVolume,
      baselineVolume: baselineVolume || currentVolume,
      currentOI,
      previousOI: currentOI * (1 - (oi?.oiChange || 0) / 100),
      currentPrice,
      previousPrice,
    },
    computedDeltas: {
      volumeDelta: state.metrics.volumeDelta,
      oiDelta: state.metrics.oiDelta,
      priceDelta: state.metrics.priceDelta,
    },
    thresholds: DEFAULT_THRESHOLDS,
    decision: {
      regime: state.regime,
      confidence: state.confidence,
      reasons: state.drivers,
      alternativeRegimes: getAlternativeRegimes(state.metrics),
    },
    history,
  };
}

/**
 * Get all tracked symbols with regime data
 */
export function getTrackedSymbols(): string[] {
  return Array.from(regimeCache.keys());
}

/**
 * Clear all caches
 */
export function clearCaches(): void {
  regimeCache.clear();
  regimeHistory.clear();
  priceBaseline.clear();
  volumeBaseline.clear();
}

/**
 * Get regime summary for all symbols
 */
export function getAllRegimes(): MarketRegimeState[] {
  const symbols = getTrackedSymbols();
  return symbols.map(s => detectRegime(s));
}
