/**
 * S10.W — Whale State Service
 * 
 * Calculates WhaleMarketState from LargePositionSnapshots.
 * Also calculates the 6 whale indicators.
 * 
 * NO SIGNALS, NO PREDICTIONS — only measurements.
 */

import {
  LargePositionSnapshot,
  WhaleMarketState,
  WhaleIndicators,
  ExchangeId,
  WHALE_THRESHOLDS,
} from './whale.types.js';

// ═══════════════════════════════════════════════════════════════
// STATE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Build WhaleMarketState from a list of position snapshots.
 */
export function buildWhaleMarketState(
  exchange: ExchangeId,
  symbol: string,
  snapshots: LargePositionSnapshot[],
  retailFlowDelta?: number,
  totalFlow?: number
): WhaleMarketState {
  const now = Date.now();
  
  // Filter by symbol if needed
  const positions = snapshots.filter(s => s.symbol === symbol);
  
  if (positions.length === 0) {
    return createEmptyState(exchange, symbol, now);
  }
  
  // Separate long/short
  const longs = positions.filter(p => p.side === 'LONG');
  const shorts = positions.filter(p => p.side === 'SHORT');
  
  // Aggregates
  const totalLongUsd = longs.reduce((sum, p) => sum + p.sizeUsd, 0);
  const totalShortUsd = shorts.reduce((sum, p) => sum + p.sizeUsd, 0);
  const totalUsd = totalLongUsd + totalShortUsd;
  
  // Net bias
  const netBias = totalUsd > 0 
    ? (totalLongUsd - totalShortUsd) / totalUsd 
    : 0;
  
  // Position sizes for statistics
  const allSizes = positions.map(p => p.sizeUsd).sort((a, b) => a - b);
  const medianPositionUsd = calculateMedian(allSizes);
  const maxSinglePositionUsd = Math.max(...allSizes);
  
  // Top positions
  const topPositions = [...positions]
    .sort((a, b) => b.sizeUsd - a.sizeUsd)
    .slice(0, WHALE_THRESHOLDS.TOP_POSITIONS_COUNT);
  
  // Concentration Index (Herfindahl-Hirschman style)
  const concentrationIndex = calculateConcentration(positions);
  
  // Crowding Risk (requires retail flow data)
  const crowdingRisk = calculateCrowdingRisk(netBias, retailFlowDelta, totalFlow);
  
  // Confidence (weighted average)
  const confidence = calculateWeightedConfidence(positions);
  
  // Last activity
  const lastActivity = Math.max(...positions.map(p => p.lastSeenTimestamp));
  const timeSinceLastActivity = now - lastActivity;
  
  // Determine source (most common among positions)
  const source = getMostCommonSource(positions);
  
  return {
    exchange,
    symbol,
    timestamp: now,
    totalLongUsd,
    totalShortUsd,
    netBias,
    whaleLongCount: longs.length,
    whaleShortCount: shorts.length,
    topPositions,
    maxSinglePositionUsd,
    medianPositionUsd,
    concentrationIndex,
    crowdingRisk,
    confidence,
    source,
    timeSinceLastActivity,
  };
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate whale indicators from state.
 * 
 * These are the 6 indicators from S10.W spec:
 * 1. Large Position Presence (LPP)
 * 2. Whale Side Bias (WSB)
 * 3. Position Crowding Against Whales (PCAW)
 * 4. Stop-Hunt Probability Index (SHPI)
 * 5. Large Position Survival Time (LPST)
 * 6. Contrarian Pressure Index (CPI)
 */
export function calculateWhaleIndicators(
  state: WhaleMarketState,
  volatilitySpike?: number,
  liquidityVacuum?: number,
  medianWhaleLifetimeMs?: number
): WhaleIndicators {
  // 1. Large Position Presence (LPP)
  // Formula: clamp(maxSinglePositionUsd / (medianPositionUsd × k), 0, 1)
  const lpp = state.medianPositionUsd > 0
    ? Math.min(1, state.maxSinglePositionUsd / (state.medianPositionUsd * WHALE_THRESHOLDS.SIZE_MULTIPLIER))
    : 0;
  
  // 2. Whale Side Bias (WSB)
  // Already calculated in state as netBias
  const wsb = state.netBias;
  
  // 3. Position Crowding Against Whales (PCAW)
  // Already calculated in state as crowdingRisk, but we need to adjust range
  // crowdingRisk is 0..1, PCAW should be -1..+1
  // Positive PCAW = crowd against whales
  const pcaw = state.crowdingRisk * 2 - 1;
  
  // 4. Stop-Hunt Probability Index (SHPI)
  // Formula: 0.4 × |PCAW| + 0.3 × volatilitySpike + 0.3 × liquidityVacuum
  const volSpike = volatilitySpike ?? 0;
  const liqVac = liquidityVacuum ?? 0;
  const shpi = 0.4 * Math.abs(pcaw) + 0.3 * volSpike + 0.3 * liqVac;
  
  // 5. Large Position Survival Time (LPST)
  // Formula: log(timeAlive / medianWhaleLifetime)
  // For now, use state.timeSinceLastActivity as proxy
  const defaultLifetimeMs = medianWhaleLifetimeMs ?? 4 * 60 * 60 * 1000; // 4 hours default
  const timeAlive = state.timeSinceLastActivity ?? defaultLifetimeMs;
  // Normalize to -1..+1 using tanh
  const survivalRatio = timeAlive / defaultLifetimeMs;
  const lpst = Math.tanh(Math.log(survivalRatio + 0.001));
  
  // 6. Contrarian Pressure Index (CPI)
  // Formula: |PCAW| × SHPI × (1 - LPST_norm)
  // Where LPST_norm is (LPST + 1) / 2 to map to 0..1
  const lpstNorm = (lpst + 1) / 2;
  const cpi = Math.abs(pcaw) * shpi * (1 - lpstNorm);
  
  return {
    large_position_presence: clamp(lpp, 0, 1),
    whale_side_bias: clamp(wsb, -1, 1),
    position_crowding_against_whales: clamp(pcaw, -1, 1),
    stop_hunt_probability: clamp(shpi, 0, 1),
    large_position_survival_time: clamp(lpst, -1, 1),
    contrarian_pressure_index: clamp(cpi, 0, 1),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function createEmptyState(
  exchange: ExchangeId,
  symbol: string,
  timestamp: number
): WhaleMarketState {
  return {
    exchange,
    symbol,
    timestamp,
    totalLongUsd: 0,
    totalShortUsd: 0,
    netBias: 0,
    whaleLongCount: 0,
    whaleShortCount: 0,
    topPositions: [],
    maxSinglePositionUsd: 0,
    medianPositionUsd: 0,
    concentrationIndex: 0,
    crowdingRisk: 0,
    confidence: 0,
    source: 'mock',
  };
}

function calculateMedian(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  const mid = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 0
    ? (sortedValues[mid - 1] + sortedValues[mid]) / 2
    : sortedValues[mid];
}

/**
 * Concentration Index using Herfindahl-Hirschman Index (HHI) style.
 * Returns 0..1 where 1 = one whale controls everything.
 */
function calculateConcentration(positions: LargePositionSnapshot[]): number {
  if (positions.length === 0) return 0;
  if (positions.length === 1) return 1;
  
  const totalUsd = positions.reduce((sum, p) => sum + p.sizeUsd, 0);
  if (totalUsd === 0) return 0;
  
  // Sum of squared market shares
  let hhi = 0;
  for (const pos of positions) {
    const share = pos.sizeUsd / totalUsd;
    hhi += share * share;
  }
  
  // Normalize: HHI ranges from 1/n (equal) to 1 (monopoly)
  // Transform to 0..1 scale
  const minHhi = 1 / positions.length;
  const normalizedHhi = (hhi - minHhi) / (1 - minHhi);
  
  return Math.max(0, Math.min(1, normalizedHhi));
}

/**
 * Crowding Risk: how much is retail positioned against whales?
 * Returns 0..1 where 1 = maximum crowding against whales.
 */
function calculateCrowdingRisk(
  whaleBias: number,
  retailFlowDelta?: number,
  totalFlow?: number
): number {
  // If no retail flow data, return neutral
  if (retailFlowDelta === undefined || totalFlow === undefined || totalFlow === 0) {
    return 0.5;
  }
  
  // Retail flow bias: positive = retail buying, negative = retail selling
  const retailBias = retailFlowDelta / totalFlow;
  
  // Crowding = whale bias opposite to retail bias
  // If whales long (whaleBias > 0) and retail selling (retailBias < 0) → crowding high
  // If whales short (whaleBias < 0) and retail buying (retailBias > 0) → crowding high
  
  // Multiply biases: if opposite signs, result is negative
  const alignment = whaleBias * retailBias;
  
  // Convert to crowding: -1 → max crowding (1), +1 → no crowding (0)
  const crowding = (1 - alignment) / 2;
  
  return Math.max(0, Math.min(1, crowding));
}

function calculateWeightedConfidence(positions: LargePositionSnapshot[]): number {
  if (positions.length === 0) return 0;
  
  const totalUsd = positions.reduce((sum, p) => sum + p.sizeUsd, 0);
  if (totalUsd === 0) return 0;
  
  let weightedSum = 0;
  for (const pos of positions) {
    weightedSum += pos.confidence * pos.sizeUsd;
  }
  
  return weightedSum / totalUsd;
}

function getMostCommonSource(positions: LargePositionSnapshot[]): 'api' | 'sdk' | 'mock' | 'synthetic' {
  if (positions.length === 0) return 'mock';
  
  const counts = new Map<string, number>();
  for (const pos of positions) {
    counts.set(pos.source, (counts.get(pos.source) ?? 0) + 1);
  }
  
  let maxCount = 0;
  let maxSource: string = 'mock';
  for (const [source, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxSource = source;
    }
  }
  
  return maxSource as 'api' | 'sdk' | 'mock' | 'synthetic';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

console.log('[S10.W] Whale State Service loaded');
