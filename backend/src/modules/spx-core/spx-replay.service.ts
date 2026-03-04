/**
 * SPX CORE — Replay Service
 * 
 * BLOCK B5.2.2 — Replay Path Builder
 * 
 * Builds replay trajectory paths from historical match aftermath.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import type { SpxRawMatch } from './spx-scan.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PathPoint {
  t: number;       // Day offset from NOW (0 = today, 1 = +1d, etc.)
  price: number;   // Absolute price
  pct: number;     // % change from anchor
  ts?: number;     // Optional timestamp
}

export interface ReplayPath {
  matchId: string;
  anchorPrice: number;
  horizonDays: number;
  points: PathPoint[];
  terminal: {
    price: number;
    pct: number;
    return: number;
  };
  metrics: {
    maxDrawdown: number;
    maxExcursion: number;
    volatility: number;
  };
}

export interface SyntheticPath {
  anchorPrice: number;
  horizonDays: number;
  points: PathPoint[];
  bands: {
    upper: PathPoint[];
    lower: PathPoint[];
  };
  terminal: {
    price: number;
    pct: number;
    p10: number;
    p50: number;
    p90: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// REPLAY PATH BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build replay path for a specific match
 */
export function buildReplayPath(
  match: SpxRawMatch,
  anchorPrice: number,
  horizonDays: number
): ReplayPath {
  const points: PathPoint[] = [];
  
  // Start point (t=0 = NOW)
  points.push({
    t: 0,
    price: anchorPrice,
    pct: 0,
  });
  
  // Build path from aftermath
  const aftermath = match.aftermathNormalized || [];
  const len = Math.min(aftermath.length, horizonDays);
  
  let peak = anchorPrice;
  let maxDD = 0;
  let maxUp = 0;
  const returns: number[] = [];
  
  for (let i = 0; i < len; i++) {
    const pctFromBase = aftermath[i]; // Already in decimal (0.05 = 5%)
    const price = anchorPrice * (1 + pctFromBase);
    
    points.push({
      t: i + 1,
      price,
      pct: pctFromBase * 100, // Convert to percentage
    });
    
    // Track metrics
    if (price > peak) peak = price;
    const dd = (peak - price) / peak;
    if (dd > maxDD) maxDD = dd;
    
    const excursion = (price - anchorPrice) / anchorPrice;
    if (excursion > maxUp) maxUp = excursion;
    
    if (i > 0) {
      returns.push((price - points[i].price) / points[i].price);
    }
  }
  
  // Calculate volatility
  const volatility = returns.length > 1 
    ? calculateVolatility(returns) 
    : 0;
  
  const terminal = points[points.length - 1];
  
  return {
    matchId: match.id,
    anchorPrice,
    horizonDays,
    points,
    terminal: {
      price: terminal.price,
      pct: terminal.pct,
      return: match.return,
    },
    metrics: {
      maxDrawdown: maxDD * 100,
      maxExcursion: maxUp * 100,
      volatility: volatility * 100,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// SYNTHETIC PATH BUILDER
// ═══════════════════════════════════════════════════════════════

/**
 * Build synthetic forecast path from distribution of matches
 */
export function buildSyntheticPath(
  matches: SpxRawMatch[],
  anchorPrice: number,
  horizonDays: number
): SyntheticPath {
  if (matches.length === 0) {
    return createEmptySyntheticPath(anchorPrice, horizonDays);
  }
  
  const points: PathPoint[] = [];
  const upperPoints: PathPoint[] = [];
  const lowerPoints: PathPoint[] = [];
  
  // Start point
  points.push({ t: 0, price: anchorPrice, pct: 0 });
  upperPoints.push({ t: 0, price: anchorPrice, pct: 0 });
  lowerPoints.push({ t: 0, price: anchorPrice, pct: 0 });
  
  // For each day, calculate percentiles across all matches
  for (let day = 0; day < horizonDays; day++) {
    const dayValues: number[] = [];
    
    for (const match of matches) {
      if (match.aftermathNormalized && match.aftermathNormalized[day] !== undefined) {
        dayValues.push(match.aftermathNormalized[day]);
      }
    }
    
    if (dayValues.length === 0) continue;
    
    dayValues.sort((a, b) => a - b);
    
    const p10 = percentile(dayValues, 0.10);
    const p50 = percentile(dayValues, 0.50);
    const p90 = percentile(dayValues, 0.90);
    
    // Median path
    points.push({
      t: day + 1,
      price: anchorPrice * (1 + p50),
      pct: p50 * 100,
    });
    
    // Upper band (p75-p90 blend)
    const p75 = percentile(dayValues, 0.75);
    const upperPct = p75 + 0.5 * (p90 - p75);
    upperPoints.push({
      t: day + 1,
      price: anchorPrice * (1 + upperPct),
      pct: upperPct * 100,
    });
    
    // Lower band (p10-p25 blend)
    const p25 = percentile(dayValues, 0.25);
    const lowerPct = p25 - 0.5 * (p25 - p10);
    lowerPoints.push({
      t: day + 1,
      price: anchorPrice * (1 + lowerPct),
      pct: lowerPct * 100,
    });
  }
  
  // Terminal stats
  const terminalValues = matches
    .map(m => m.aftermathNormalized?.[horizonDays - 1])
    .filter((v): v is number => v !== undefined);
  
  terminalValues.sort((a, b) => a - b);
  
  const terminal = points[points.length - 1] || { price: anchorPrice, pct: 0 };
  
  return {
    anchorPrice,
    horizonDays,
    points,
    bands: {
      upper: upperPoints,
      lower: lowerPoints,
    },
    terminal: {
      price: terminal.price,
      pct: terminal.pct,
      p10: terminalValues.length > 0 ? percentile(terminalValues, 0.10) * 100 : 0,
      p50: terminalValues.length > 0 ? percentile(terminalValues, 0.50) * 100 : 0,
      p90: terminalValues.length > 0 ? percentile(terminalValues, 0.90) * 100 : 0,
    },
  };
}

/**
 * Build distribution series for all horizons
 */
export function buildDistributionSeries(
  matches: SpxRawMatch[],
  horizonDays: number
): {
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
} {
  const p10: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];
  
  for (let day = 0; day < horizonDays; day++) {
    const dayValues: number[] = [];
    
    for (const match of matches) {
      if (match.aftermathNormalized?.[day] !== undefined) {
        dayValues.push(match.aftermathNormalized[day]);
      }
    }
    
    if (dayValues.length === 0) {
      p10.push(0);
      p25.push(0);
      p50.push(0);
      p75.push(0);
      p90.push(0);
    } else {
      dayValues.sort((a, b) => a - b);
      p10.push(percentile(dayValues, 0.10));
      p25.push(percentile(dayValues, 0.25));
      p50.push(percentile(dayValues, 0.50));
      p75.push(percentile(dayValues, 0.75));
      p90.push(percentile(dayValues, 0.90));
    }
  }
  
  return { p10, p25, p50, p75, p90 };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const idx = Math.floor(p * (arr.length - 1));
  return arr[Math.min(idx, arr.length - 1)];
}

function calculateVolatility(returns: number[]): number {
  if (returns.length < 2) return 0;
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
  
  return Math.sqrt(variance);
}

function createEmptySyntheticPath(anchorPrice: number, horizonDays: number): SyntheticPath {
  const points: PathPoint[] = [{ t: 0, price: anchorPrice, pct: 0 }];
  
  for (let i = 1; i <= horizonDays; i++) {
    points.push({ t: i, price: anchorPrice, pct: 0 });
  }
  
  return {
    anchorPrice,
    horizonDays,
    points,
    bands: {
      upper: [...points],
      lower: [...points],
    },
    terminal: {
      price: anchorPrice,
      pct: 0,
      p10: 0,
      p50: 0,
      p90: 0,
    },
  };
}

export default {
  buildReplayPath,
  buildSyntheticPath,
  buildDistributionSeries,
};
