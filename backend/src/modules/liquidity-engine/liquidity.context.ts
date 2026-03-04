/**
 * LIQUIDITY CONTEXT SERVICE — P2.1
 * 
 * Builds context for each liquidity series:
 * - Normalizes to weekly-as-of (Friday)
 * - Computes deltas (4w, 13w, 26w)
 * - Computes rolling Z-scores (5-year window)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import {
  LIQUIDITY_SERIES,
  LiquiditySeriesId,
  LiquiditySeriesContext,
  LiquidityDeltas,
  LiquidityZScores,
} from './liquidity.contract.js';
import { getLiquiditySeriesPoints } from './liquidity.ingest.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Rolling window for Z-score calculation (5 years in weeks) */
const ZSCORE_WINDOW_WEEKS = 260;  // 5 * 52

/** Minimum points required for statistics */
const MIN_POINTS_FOR_STATS = 52;  // 1 year minimum

// ═══════════════════════════════════════════════════════════════
// STATISTICAL HELPERS
// ═══════════════════════════════════════════════════════════════

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + Math.pow(v - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ═══════════════════════════════════════════════════════════════
// WEEKLY NORMALIZATION
// ═══════════════════════════════════════════════════════════════

interface WeeklyPoint {
  weekEnd: string;    // Friday date (YYYY-MM-DD)
  value: number;
}

/**
 * Convert any frequency data to weekly-as-of (Friday)
 * For daily data: takes last value of week
 * For weekly data: uses as-is (assuming Friday release)
 */
function normalizeToWeekly(
  points: Array<{ date: string; value: number }>,
  frequency: 'daily' | 'weekly'
): WeeklyPoint[] {
  if (frequency === 'weekly') {
    // Weekly data: assume Friday release, use as-is
    return points.map(p => ({
      weekEnd: p.date,
      value: p.value,
    }));
  }
  
  // Daily data: aggregate by week (take last value)
  const byWeek = new Map<string, { date: string; value: number }>();
  
  for (const p of points) {
    const d = new Date(p.date);
    // Get Friday of this week
    const dayOfWeek = d.getUTCDay();
    const daysToFriday = (5 - dayOfWeek + 7) % 7;
    const friday = new Date(d);
    friday.setUTCDate(d.getUTCDate() + daysToFriday);
    const weekKey = friday.toISOString().split('T')[0];
    
    // Keep last value of each week
    const existing = byWeek.get(weekKey);
    if (!existing || p.date >= existing.date) {
      byWeek.set(weekKey, p);
    }
  }
  
  // Convert to sorted array
  const result: WeeklyPoint[] = [];
  for (const [weekEnd, point] of byWeek) {
    result.push({ weekEnd, value: point.value });
  }
  
  return result.sort((a, b) => a.weekEnd.localeCompare(b.weekEnd));
}

// ═══════════════════════════════════════════════════════════════
// DELTA CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute deltas from weekly data
 * @param weekly Sorted weekly points
 * @param currentValue Current value
 */
function computeDeltas(
  weekly: WeeklyPoint[],
  currentValue: number
): LiquidityDeltas {
  const n = weekly.length;
  
  return {
    delta4w: n >= 4 ? currentValue - weekly[n - 4].value : null,
    delta13w: n >= 13 ? currentValue - weekly[n - 13].value : null,
    delta26w: n >= 26 ? currentValue - weekly[n - 26].value : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// Z-SCORE CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute rolling Z-scores for deltas using 5-year window
 */
function computeZScores(
  weekly: WeeklyPoint[],
  deltas: LiquidityDeltas
): LiquidityZScores {
  // Need enough data for meaningful statistics
  if (weekly.length < MIN_POINTS_FOR_STATS) {
    return { z4w: null, z13w: null, z26w: null };
  }
  
  // Calculate delta history for Z-score
  const windowStart = Math.max(0, weekly.length - ZSCORE_WINDOW_WEEKS);
  const windowWeekly = weekly.slice(windowStart);
  
  // Build delta arrays for each horizon
  const deltas4w: number[] = [];
  const deltas13w: number[] = [];
  const deltas26w: number[] = [];
  
  for (let i = 0; i < windowWeekly.length; i++) {
    if (i >= 4) {
      deltas4w.push(windowWeekly[i].value - windowWeekly[i - 4].value);
    }
    if (i >= 13) {
      deltas13w.push(windowWeekly[i].value - windowWeekly[i - 13].value);
    }
    if (i >= 26) {
      deltas26w.push(windowWeekly[i].value - windowWeekly[i - 26].value);
    }
  }
  
  // Compute Z-scores
  const computeZ = (deltaArr: number[], currentDelta: number | null): number | null => {
    if (currentDelta === null || deltaArr.length < 20) return null;
    
    const m = mean(deltaArr);
    const sd = stdDev(deltaArr);
    
    if (sd < 0.001) return 0;  // Avoid division by zero
    
    return clamp((currentDelta - m) / sd, -4, 4);
  };
  
  return {
    z4w: computeZ(deltas4w, deltas.delta4w),
    z13w: computeZ(deltas13w, deltas.delta13w),
    z26w: computeZ(deltas26w, deltas.delta26w),
  };
}

// ═══════════════════════════════════════════════════════════════
// 5-YEAR STATISTICS
// ═══════════════════════════════════════════════════════════════

function compute5YearStats(weekly: WeeklyPoint[]): {
  mean5y: number;
  std5y: number;
  min5y: number;
  max5y: number;
} | null {
  if (weekly.length < MIN_POINTS_FOR_STATS) return null;
  
  const windowStart = Math.max(0, weekly.length - ZSCORE_WINDOW_WEEKS);
  const values = weekly.slice(windowStart).map(w => w.value);
  
  return {
    mean5y: Math.round(mean(values) * 100) / 100,
    std5y: Math.round(stdDev(values) * 100) / 100,
    min5y: Math.min(...values),
    max5y: Math.max(...values),
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Build context for a single liquidity series
 */
export async function buildLiquiditySeriesContext(
  seriesId: LiquiditySeriesId
): Promise<LiquiditySeriesContext> {
  const spec = LIQUIDITY_SERIES[seriesId];
  const displayName = spec?.displayName ?? seriesId;
  
  try {
    // Get raw points
    const rawPoints = await getLiquiditySeriesPoints(seriesId);
    
    if (rawPoints.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Normalize to weekly
    const weekly = normalizeToWeekly(rawPoints, spec.frequency);
    
    if (weekly.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Current value (latest week)
    const latest = weekly[weekly.length - 1];
    const currentValue = latest.value;
    const currentDate = latest.weekEnd;
    
    // Compute deltas
    const deltas = computeDeltas(weekly, currentValue);
    
    // Compute Z-scores
    const zscores = computeZScores(weekly, deltas);
    
    // Compute 5-year stats
    const stats = compute5YearStats(weekly);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: {
        value: Math.round(currentValue * 100) / 100,
        date: currentDate,
      },
      deltas: {
        delta4w: deltas.delta4w !== null ? Math.round(deltas.delta4w * 100) / 100 : null,
        delta13w: deltas.delta13w !== null ? Math.round(deltas.delta13w * 100) / 100 : null,
        delta26w: deltas.delta26w !== null ? Math.round(deltas.delta26w * 100) / 100 : null,
      },
      zscores: {
        z4w: zscores.z4w !== null ? Math.round(zscores.z4w * 1000) / 1000 : null,
        z13w: zscores.z13w !== null ? Math.round(zscores.z13w * 1000) / 1000 : null,
        z26w: zscores.z26w !== null ? Math.round(zscores.z26w * 1000) / 1000 : null,
      },
      stats,
    };
    
  } catch (error: any) {
    console.error(`[Liquidity Context] Failed to build ${seriesId}:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

function buildEmptyContext(
  seriesId: LiquiditySeriesId,
  displayName: string
): LiquiditySeriesContext {
  return {
    seriesId,
    displayName,
    available: false,
    current: null,
    deltas: { delta4w: null, delta13w: null, delta26w: null },
    zscores: { z4w: null, z13w: null, z26w: null },
    stats: null,
  };
}

// ═══════════════════════════════════════════════════════════════
// P3: AS-OF SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

import { filterByAsOf } from '../macro-asof/asof.service.js';

/**
 * P3: Build context for a single liquidity series as of a specific date.
 * Only uses data that would have been available at asOfDate.
 */
export async function buildLiquiditySeriesContextAsOf(
  seriesId: LiquiditySeriesId,
  asOfDate: string
): Promise<LiquiditySeriesContext> {
  const spec = LIQUIDITY_SERIES[seriesId];
  const displayName = spec?.displayName ?? seriesId;
  
  try {
    // Get raw points
    const rawPoints = await getLiquiditySeriesPoints(seriesId);
    
    // P3: Filter by publication lag
    const filteredPoints = filterByAsOf(rawPoints, asOfDate, seriesId);
    
    if (filteredPoints.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Normalize to weekly
    const weekly = normalizeToWeekly(filteredPoints, spec.frequency);
    
    if (weekly.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Current value (latest available week)
    const latest = weekly[weekly.length - 1];
    const currentValue = latest.value;
    const currentDate = latest.weekEnd;
    
    // Compute deltas
    const deltas = computeDeltas(weekly, currentValue);
    
    // Compute Z-scores
    const zscores = computeZScores(weekly, deltas);
    
    // Compute 5-year stats
    const stats = compute5YearStats(weekly);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: {
        value: Math.round(currentValue * 100) / 100,
        date: currentDate,
      },
      deltas: {
        delta4w: deltas.delta4w !== null ? Math.round(deltas.delta4w * 100) / 100 : null,
        delta13w: deltas.delta13w !== null ? Math.round(deltas.delta13w * 100) / 100 : null,
        delta26w: deltas.delta26w !== null ? Math.round(deltas.delta26w * 100) / 100 : null,
      },
      zscores: {
        z4w: zscores.z4w !== null ? Math.round(zscores.z4w * 1000) / 1000 : null,
        z13w: zscores.z13w !== null ? Math.round(zscores.z13w * 1000) / 1000 : null,
        z26w: zscores.z26w !== null ? Math.round(zscores.z26w * 1000) / 1000 : null,
      },
      stats,
    };
    
  } catch (error: any) {
    console.error(`[Liquidity Context] Failed to build ${seriesId} as of ${asOfDate}:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}
