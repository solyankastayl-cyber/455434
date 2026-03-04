/**
 * S10.4 — Liquidation Cascade Service
 * 
 * Orchestrates cascade detection and maintains history.
 * Uses S10.1 data and S10.3 regime context.
 */

import {
  LiquidationCascadeState,
  CascadeHistoryEntry,
  CascadeDiagnostics,
  CascadePhase,
  DEFAULT_CASCADE_THRESHOLDS,
} from './cascade.types.js';
import { detectCascade } from './cascade.detector.js';
import * as exchangeDataService from '../exchange-data.service.js';
import * as regimeService from '../regimes/regime.service.js';

// Caches
const cascadeCache: Map<string, LiquidationCascadeState> = new Map();
const cascadeHistory: Map<string, CascadeHistoryEntry[]> = new Map();
const phaseHistory: Map<string, Array<{ phase: CascadePhase; timestamp: Date; reason: string }>> = new Map();
const rateHistory: Map<string, number[]> = new Map();

const MAX_HISTORY = 20;
const RATE_WINDOW = 10;
const DETECTION_WINDOW_SEC = 60; // 1 minute window

/**
 * Calculate baseline rate from history
 */
function getBaselineRate(symbol: string): number {
  const history = rateHistory.get(symbol) || [];
  if (history.length < 3) return 1; // Default baseline
  
  // Use median of last N samples (excluding current)
  const sorted = [...history.slice(0, -1)].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
}

/**
 * Get peak rate from current cascade
 */
function getPeakRate(symbol: string): number {
  const state = cascadeCache.get(symbol);
  if (!state?.active) return 0;
  
  const history = rateHistory.get(symbol) || [];
  return Math.max(...history);
}

/**
 * Detect cascade for a symbol
 */
export function detectLiquidationCascade(symbol: string): LiquidationCascadeState {
  const now = new Date();
  const previousState = cascadeCache.get(symbol);
  
  // Get data from S10.1
  const liquidations = exchangeDataService.getLiquidations(symbol);
  const oi = exchangeDataService.getOpenInterest(symbol);
  const markets = exchangeDataService.getMarkets();
  const market = markets.find(m => m.symbol === symbol);
  const overview = exchangeDataService.getOverview();
  
  // Get regime from S10.3
  const regimeState = regimeService.getRegimeState(symbol);
  const regime = regimeState?.regime || 'NEUTRAL';
  
  // Calculate liquidation metrics
  const windowStart = now.getTime() - DETECTION_WINDOW_SEC * 1000;
  const recentLiqs = liquidations.filter(l => l.timestamp.getTime() > windowStart);
  
  let longVolume = 0;
  let shortVolume = 0;
  for (const liq of recentLiqs) {
    if (liq.side === 'LONG') {
      longVolume += liq.size;
    } else {
      shortVolume += liq.size;
    }
  }
  const totalVolume = longVolume + shortVolume;
  const liquidationRate = recentLiqs.length; // Events per window
  
  // Update rate history
  const rates = rateHistory.get(symbol) || [];
  rates.push(liquidationRate);
  if (rates.length > RATE_WINDOW) rates.shift();
  rateHistory.set(symbol, rates);
  
  const baselineRate = getBaselineRate(symbol);
  const peakRate = getPeakRate(symbol);
  const previousRate = previousState?.active ? rates[rates.length - 2] || 0 : 0;
  
  // Price change calculation
  const priceChange = market?.change24h || 0;
  const priceVelocity = priceChange / 24; // Simplified
  
  // Run detection
  const detection = detectCascade(
    {
      liquidationRate,
      liquidationVolumeUsd: totalVolume,
      longLiqVolume: longVolume,
      shortLiqVolume: shortVolume,
      oiDeltaPct: oi?.oiChange || 0,
      priceVelocity,
      priceDeltaPct: priceChange,
      regime,
    },
    {
      wasActive: previousState?.active || false,
      previousRate,
      peakRate,
      baselineRate,
    }
  );
  
  // Calculate duration
  let durationSec = 0;
  let startedAt = previousState?.startedAt || null;
  
  if (detection.active) {
    if (!previousState?.active) {
      startedAt = now;
    } else if (startedAt) {
      durationSec = Math.floor((now.getTime() - startedAt.getTime()) / 1000);
    }
  } else {
    startedAt = null;
  }
  
  // Build state
  const state: LiquidationCascadeState = {
    symbol,
    active: detection.active,
    direction: detection.direction,
    phase: detection.phase,
    intensity: detection.intensity,
    intensityScore: detection.intensityScore,
    liquidationVolumeUsd: totalVolume,
    oiDeltaPct: oi?.oiChange || 0,
    priceDeltaPct: priceChange,
    durationSec,
    drivers: detection.drivers,
    regimeContext: regime,
    confidence: detection.confidence,
    startedAt,
    timestamp: now,
  };
  
  // Track phase transitions
  if (detection.phase && detection.active) {
    const phases = phaseHistory.get(symbol) || [];
    const lastPhase = phases[phases.length - 1];
    
    if (!lastPhase || lastPhase.phase !== detection.phase) {
      phases.push({
        phase: detection.phase,
        timestamp: now,
        reason: detection.drivers[0] || 'Phase transition',
      });
      if (phases.length > MAX_HISTORY) phases.shift();
      phaseHistory.set(symbol, phases);
    }
  }
  
  // Handle cascade end - save to history
  if (previousState?.active && !detection.active && previousState.startedAt) {
    const history = cascadeHistory.get(symbol) || [];
    const phases = phaseHistory.get(symbol) || [];
    
    history.push({
      direction: previousState.direction!,
      peakIntensity: previousState.intensity,
      peakIntensityScore: Math.max(previousState.intensityScore, detection.intensityScore),
      totalVolumeUsd: previousState.liquidationVolumeUsd,
      maxOiDrop: Math.abs(previousState.oiDeltaPct),
      maxPriceMove: Math.abs(previousState.priceDeltaPct),
      durationSec: previousState.durationSec,
      startedAt: previousState.startedAt,
      endedAt: now,
      phases: phases.map(p => ({ phase: p.phase, timestamp: p.timestamp })),
    });
    
    if (history.length > MAX_HISTORY) history.shift();
    cascadeHistory.set(symbol, history);
    
    // Clear phase history for next cascade
    phaseHistory.set(symbol, []);
  }
  
  cascadeCache.set(symbol, state);
  return state;
}

/**
 * Get current cascade state
 */
export function getCascadeState(symbol: string): LiquidationCascadeState {
  return detectLiquidationCascade(symbol);
}

/**
 * Get cascade history
 */
export function getCascadeHistory(symbol: string, limit: number = 10): CascadeHistoryEntry[] {
  return (cascadeHistory.get(symbol) || []).slice(-limit);
}

/**
 * Get all active cascades
 */
export function getActiveCascades(): LiquidationCascadeState[] {
  const results: LiquidationCascadeState[] = [];
  
  for (const [symbol, state] of cascadeCache.entries()) {
    if (state.active) {
      results.push(state);
    }
  }
  
  return results;
}

/**
 * Get diagnostics for admin
 */
export function getDiagnostics(symbol: string): CascadeDiagnostics {
  const state = detectLiquidationCascade(symbol);
  const history = getCascadeHistory(symbol);
  const phases = phaseHistory.get(symbol) || [];
  const rates = rateHistory.get(symbol) || [];
  
  // Get raw data
  const liquidations = exchangeDataService.getLiquidations(symbol);
  const oi = exchangeDataService.getOpenInterest(symbol);
  const markets = exchangeDataService.getMarkets();
  const market = markets.find(m => m.symbol === symbol);
  const regimeState = regimeService.getRegimeState(symbol);
  
  const windowStart = Date.now() - DETECTION_WINDOW_SEC * 1000;
  const recentLiqs = liquidations.filter(l => l.timestamp.getTime() > windowStart);
  
  let longVolume = 0;
  let shortVolume = 0;
  for (const liq of recentLiqs) {
    if (liq.side === 'LONG') longVolume += liq.size;
    else shortVolume += liq.size;
  }
  
  const baselineRate = getBaselineRate(symbol);
  const cascadeEligible = ['EXPANSION', 'LONG_SQUEEZE', 'SHORT_SQUEEZE'].includes(regimeState?.regime || '');
  
  return {
    symbol,
    currentState: state,
    rawInputs: {
      recentLiquidations: recentLiqs.length,
      totalVolumeUsd: longVolume + shortVolume,
      longVolume,
      shortVolume,
      oiChange: oi?.oiChange || 0,
      priceChange: market?.change24h || 0,
      currentRegime: regimeState?.regime || 'NEUTRAL',
    },
    computedMetrics: {
      liquidationRate: recentLiqs.length,
      intensityScore: state.intensityScore,
      cascadeEligible,
      eligibilityReason: cascadeEligible 
        ? 'Regime eligible for cascade'
        : `Regime ${regimeState?.regime} not eligible`,
    },
    thresholds: DEFAULT_CASCADE_THRESHOLDS,
    phaseHistory: phases,
    history,
  };
}

/**
 * Get tracked symbols
 */
export function getTrackedSymbols(): string[] {
  return Array.from(cascadeCache.keys());
}

/**
 * Clear caches
 */
export function clearCaches(): void {
  cascadeCache.clear();
  cascadeHistory.clear();
  phaseHistory.clear();
  rateHistory.clear();
}
