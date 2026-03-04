/**
 * MACRO CONTEXT SERVICE — B1 + P3 (As-Of)
 * 
 * Computes context (current, deltas, trend, regime, pressure) for each series.
 * P3: Supports as-of queries for honest backtesting.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { getMacroSeriesPoints, getLatestMacroPoint, getAllSeriesMeta } from '../ingest/macro.ingest.service.js';
import { getMacroSeriesSpec, MacroSeriesSpec, MacroRole } from '../data/macro_sources.registry.js';
import {
  MacroContext,
  MacroTrend,
  MacroRegime,
  RatesRegime,
  InflationRegime,
  LaborRegime,
  CurveRegime,
  LiquidityRegime,
} from '../contracts/macro.contracts.js';

// P3: Import as-of utilities
import { filterByAsOf, getSeriesLag } from '../../macro-asof/asof.service.js';

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

function percentile(arr: number[], value: number): number {
  if (arr.length === 0) return 50;
  const sorted = [...arr].sort((a, b) => a - b);
  let count = 0;
  for (const v of sorted) {
    if (v <= value) count++;
  }
  return Math.round((count / arr.length) * 100);
}

function zScore(value: number, m: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - m) / sd;
}

// ═══════════════════════════════════════════════════════════════
// TRANSFORM HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute YoY (Year-over-Year) change
 */
function computeYoY(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 13) return null;
  const current = points[points.length - 1].value;
  const yearAgo = points[points.length - 13].value; // ~12 months ago
  if (yearAgo === 0) return null;
  return (current - yearAgo) / yearAgo;
}

/**
 * Compute MoM (Month-over-Month) change
 */
function computeMoM(points: Array<{ date: string; value: number }>): number | null {
  if (points.length < 2) return null;
  const current = points[points.length - 1].value;
  const monthAgo = points[points.length - 2].value;
  if (monthAgo === 0) return null;
  return (current - monthAgo) / monthAgo;
}

/**
 * Compute delta (simple change)
 */
function computeDelta(points: Array<{ date: string; value: number }>, periods: number): number | null {
  if (points.length < periods + 1) return null;
  const current = points[points.length - 1].value;
  const past = points[points.length - 1 - periods].value;
  return current - past;
}

// ═══════════════════════════════════════════════════════════════
// TREND CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyTrend(delta3m: number | undefined, delta12m: number | undefined): MacroTrend {
  // Use 3m delta primarily, fallback to 12m
  const delta = delta3m ?? delta12m ?? 0;
  
  if (Math.abs(delta) < 0.01) return 'FLAT';  // Less than 1% change
  return delta > 0 ? 'UP' : 'DOWN';
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyRatesRegime(
  currentValue: number,
  delta3m: number | undefined,
  delta12m: number | undefined
): RatesRegime {
  const delta = delta3m ?? delta12m ?? 0;
  
  if (delta > 0.25) return 'TIGHTENING';  // Rising rates
  if (delta < -0.25) return 'EASING';     // Falling rates
  return 'PAUSE';
}

function classifyInflationRegime(
  yoy: number | undefined,
  delta3m: number | undefined
): InflationRegime {
  const yoyPct = (yoy ?? 0) * 100;  // Convert to percentage
  const deltaDir = delta3m ?? 0;
  
  // YoY inflation below 2% = cooling
  if (yoyPct < 2) return 'COOLING';
  
  // YoY inflation above 3% and rising = reheating
  if (yoyPct > 3 && deltaDir > 0) return 'REHEATING';
  
  // YoY 2-3% or above 3% but falling = stable
  return 'STABLE';
}

function classifyLaborRegime(
  currentValue: number,
  delta3m: number | undefined
): LaborRegime {
  // UNRATE thresholds (US context)
  if (currentValue < 4.0) return 'LOW';
  if (currentValue > 6.0) return 'STRESS';
  return 'NORMAL';
}

function classifyCurveRegime(currentValue: number): CurveRegime {
  // T10Y2Y: positive = steep, negative = inverted
  if (currentValue > 1.0) return 'STEEP';
  if (currentValue < -0.1) return 'INVERTED';
  return 'NORMAL';
}

function classifyLiquidityRegime(
  yoy: number | undefined
): LiquidityRegime {
  const yoyPct = (yoy ?? 0) * 100;
  
  if (yoyPct < -2) return 'CONTRACTION';
  if (yoyPct > 5) return 'EXPANSION';
  return 'STABLE';
}

function classifyRegime(
  role: MacroRole,
  currentValue: number,
  yoy: number | undefined,
  delta3m: number | undefined,
  delta12m: number | undefined
): MacroRegime {
  switch (role) {
    case 'rates':
      return classifyRatesRegime(currentValue, delta3m, delta12m);
    case 'inflation':
      return classifyInflationRegime(yoy, delta3m);
    case 'labor':
      return classifyLaborRegime(currentValue, delta3m);
    case 'curve':
      return classifyCurveRegime(currentValue);
    case 'liquidity':
      return classifyLiquidityRegime(yoy);
    default:
      return 'UNKNOWN';
  }
}

// ═══════════════════════════════════════════════════════════════
// PRESSURE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute pressure score (-1..+1)
 * Positive = dollar strength / risk-off pressure
 * Negative = dollar weakness / risk-on pressure
 */
function computePressure(
  role: MacroRole,
  regime: MacroRegime,
  zScore: number,
  currentValue: number
): number {
  let pressure = 0;
  
  switch (role) {
    case 'rates':
      // Higher rates = dollar strength
      if (regime === 'TIGHTENING') pressure = 0.5 + Math.min(0.5, zScore * 0.2);
      else if (regime === 'EASING') pressure = -0.5 + Math.max(-0.5, zScore * 0.2);
      else pressure = zScore * 0.3;
      break;
      
    case 'inflation':
      // Reheating inflation = tightening expectations = dollar strength (short-term)
      if (regime === 'REHEATING') pressure = 0.3 + Math.min(0.4, zScore * 0.2);
      else if (regime === 'COOLING') pressure = -0.3;
      else pressure = 0;
      break;
      
    case 'labor':
      // Stress = risk-off = dollar strength
      if (regime === 'STRESS') pressure = 0.5;
      else if (regime === 'LOW') pressure = -0.2;  // Risk-on
      else pressure = 0;
      break;
      
    case 'curve':
      // Inverted = recession risk = dollar strength (safe haven)
      if (regime === 'INVERTED') pressure = 0.6;
      else if (regime === 'STEEP') pressure = -0.3;  // Risk-on
      else pressure = 0;
      break;
      
    case 'liquidity':
      // Contraction = risk-off = dollar strength
      if (regime === 'CONTRACTION') pressure = 0.5;
      else if (regime === 'EXPANSION') pressure = -0.3;
      else pressure = 0;
      break;
      
    default:
      pressure = 0;
  }
  
  // Clamp to -1..+1
  return Math.max(-1, Math.min(1, pressure));
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyFreshness(lastDate: string, frequency: string): 'FRESH' | 'STALE' | 'OLD' {
  const now = new Date();
  const last = new Date(lastDate);
  const daysSince = (now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
  
  if (frequency === 'daily') {
    if (daysSince <= 7) return 'FRESH';
    if (daysSince <= 30) return 'STALE';
    return 'OLD';
  } else if (frequency === 'monthly') {
    if (daysSince <= 45) return 'FRESH';  // Monthly data can be ~45 days delayed
    if (daysSince <= 90) return 'STALE';
    return 'OLD';
  }
  
  // Default for weekly
  if (daysSince <= 14) return 'FRESH';
  if (daysSince <= 45) return 'STALE';
  return 'OLD';
}

// ═══════════════════════════════════════════════════════════════
// BUILD CONTEXT FOR SINGLE SERIES
// ═══════════════════════════════════════════════════════════════

export async function buildMacroContext(seriesId: string): Promise<MacroContext | null> {
  const spec = getMacroSeriesSpec(seriesId);
  if (!spec) return null;
  
  // Get all points (for stats) and last 60 for recent calcs
  const allPoints = await getMacroSeriesPoints(seriesId);
  if (allPoints.length < 13) return null;  // Need at least 1 year of data
  
  const values = allPoints.map(p => p.value);
  const lastPoint = allPoints[allPoints.length - 1];
  
  // Compute primary transform value
  let currentValue = lastPoint.value;
  let yoy: number | undefined;
  let mom: number | undefined;
  
  if (spec.primaryTransform === 'yoy') {
    yoy = computeYoY(allPoints) ?? undefined;
    if (yoy !== undefined) currentValue = yoy;
  } else if (spec.primaryTransform === 'mom') {
    mom = computeMoM(allPoints) ?? undefined;
    if (mom !== undefined) currentValue = mom;
  }
  
  // Compute deltas (for level data, use absolute delta; for rates, use % delta)
  const delta1m = computeDelta(allPoints, 1) ?? undefined;
  const delta3m = computeDelta(allPoints, 3) ?? undefined;
  const delta12m = computeDelta(allPoints, 12) ?? undefined;
  
  // Compute YoY for secondary if not primary
  if (spec.primaryTransform !== 'yoy') {
    yoy = computeYoY(allPoints) ?? undefined;
  }
  
  // Statistics (use rolling 120 months = 10 years for monthly)
  const rollingWindow = spec.frequency === 'monthly' ? 120 : 252 * 3;  // 3 years for daily
  const recentValues = values.slice(-Math.min(rollingWindow, values.length));
  const m = mean(recentValues);
  const sd = stdDev(recentValues);
  const z = zScore(lastPoint.value, m, sd);
  const pct = percentile(recentValues, lastPoint.value);
  
  // Classify
  const trend = classifyTrend(delta3m, delta12m);
  const regime = classifyRegime(spec.role, lastPoint.value, yoy, delta3m, delta12m);
  const pressure = computePressure(spec.role, regime, z, lastPoint.value);
  
  // Quality
  const firstDate = allPoints[0].date;
  const coverageYears = (new Date(lastPoint.date).getTime() - new Date(firstDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const freshness = classifyFreshness(lastPoint.date, spec.frequency);
  
  // Detect gaps (simplified: check if more than expected intervals missing)
  let gaps = 0;
  if (spec.frequency === 'monthly' && allPoints.length < coverageYears * 10) {
    gaps = Math.round(coverageYears * 12 - allPoints.length);
  }
  
  return {
    seriesId,
    displayName: spec.displayName,
    role: spec.role,
    current: {
      value: Math.round(currentValue * 10000) / 10000,
      date: lastPoint.date,
      transform: spec.primaryTransform,
    },
    deltas: {
      delta1m: delta1m !== undefined ? Math.round(delta1m * 10000) / 10000 : undefined,
      delta3m: delta3m !== undefined ? Math.round(delta3m * 10000) / 10000 : undefined,
      delta12m: delta12m !== undefined ? Math.round(delta12m * 10000) / 10000 : undefined,
    },
    stats: {
      mean: Math.round(m * 10000) / 10000,
      stdDev: Math.round(sd * 10000) / 10000,
      zScore: Math.round(z * 100) / 100,
      percentile: pct,
    },
    trend,
    regime,
    pressure: Math.round(pressure * 1000) / 1000,
    quality: {
      freshness,
      coverage: Math.round(coverageYears * 10) / 10,
      gaps,
    },
    updatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD CONTEXT FOR ALL SERIES
// ═══════════════════════════════════════════════════════════════

export async function buildAllMacroContexts(): Promise<MacroContext[]> {
  const metas = await getAllSeriesMeta();
  const contexts: MacroContext[] = [];
  
  for (const meta of metas) {
    const ctx = await buildMacroContext(meta.seriesId);
    if (ctx) {
      contexts.push(ctx);
    }
  }
  
  return contexts;
}

// ═══════════════════════════════════════════════════════════════
// P3: AS-OF CONTEXT BUILDING
// ═══════════════════════════════════════════════════════════════

/**
 * P3: Build context for a single series as of a specific date.
 * Only uses data that would have been available at asOfDate.
 */
export async function buildMacroContextAsOf(
  seriesId: string,
  asOfDate: string
): Promise<MacroContext | null> {
  const spec = getMacroSeriesSpec(seriesId);
  if (!spec) return null;
  
  // Get all points
  const rawPoints = await getMacroSeriesPoints(seriesId);
  
  // P3: Filter by publication lag
  const allPoints = filterByAsOf(rawPoints, asOfDate, seriesId);
  
  if (allPoints.length < 13) return null;  // Need at least 1 year of data
  
  const values = allPoints.map(p => p.value);
  const lastPoint = allPoints[allPoints.length - 1];
  
  // Compute primary transform value
  let currentValue = lastPoint.value;
  let yoy: number | undefined;
  let mom: number | undefined;
  
  if (spec.primaryTransform === 'yoy') {
    yoy = computeYoY(allPoints) ?? undefined;
    if (yoy !== undefined) currentValue = yoy;
  } else if (spec.primaryTransform === 'mom') {
    mom = computeMoM(allPoints) ?? undefined;
    if (mom !== undefined) currentValue = mom;
  }
  
  // Compute deltas
  const delta1m = computeDelta(allPoints, 1) ?? undefined;
  const delta3m = computeDelta(allPoints, 3) ?? undefined;
  const delta12m = computeDelta(allPoints, 12) ?? undefined;
  
  // Compute YoY for secondary if not primary
  if (spec.primaryTransform !== 'yoy') {
    yoy = computeYoY(allPoints) ?? undefined;
  }
  
  // Statistics
  const rollingWindow = spec.frequency === 'monthly' ? 120 : 252 * 3;
  const recentValues = values.slice(-Math.min(rollingWindow, values.length));
  const m = mean(recentValues);
  const sd = stdDev(recentValues);
  const z = zScore(currentValue, m, sd);
  const pct = percentile(recentValues, currentValue);
  
  // Trend
  const trend = classifyTrend(delta3m, delta12m);
  
  // Regime
  const regime = classifyRegime(spec.role, currentValue, yoy, delta3m, delta12m);
  
  // Pressure
  const pressure = computePressure(spec.role, regime, z, currentValue);
  
  // Freshness (relative to asOfDate)
  const freshness = classifyFreshnessAsOf(lastPoint.date, spec.frequency, asOfDate);
  
  // Coverage
  const firstDate = new Date(allPoints[0].date);
  const lastDate = new Date(lastPoint.date);
  const coverageYears = (lastDate.getTime() - firstDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  
  // Gap check (simplified for as-of)
  const gaps = 0;  // TODO: implement gap detection for as-of
  
  return {
    seriesId,
    displayName: spec.displayName,
    role: spec.role,
    frequency: spec.frequency,
    current: {
      value: Math.round(currentValue * 10000) / 10000,
      date: lastPoint.date,
      delta1m: delta1m !== undefined ? Math.round(delta1m * 10000) / 10000 : undefined,
      delta3m: delta3m !== undefined ? Math.round(delta3m * 10000) / 10000 : undefined,
      delta12m: delta12m !== undefined ? Math.round(delta12m * 10000) / 10000 : undefined,
      yoy: yoy !== undefined ? Math.round(yoy * 10000) / 10000 : undefined,
    },
    stats: {
      mean: Math.round(m * 10000) / 10000,
      stdDev: Math.round(sd * 10000) / 10000,
      zScore: Math.round(z * 100) / 100,
      percentile: pct,
    },
    trend,
    regime,
    pressure: Math.round(pressure * 1000) / 1000,
    quality: {
      freshness,
      coverage: Math.round(coverageYears * 10) / 10,
      gaps,
    },
    updatedAt: asOfDate,  // Use asOf date
  };
}

/**
 * P3: Freshness classification relative to asOf date
 */
function classifyFreshnessAsOf(
  lastDate: string,
  frequency: string,
  asOfDate: string
): 'FRESH' | 'STALE' | 'OLD' {
  const asOf = new Date(asOfDate);
  const last = new Date(lastDate);
  const daysSince = (asOf.getTime() - last.getTime()) / (24 * 60 * 60 * 1000);
  
  if (frequency === 'daily') {
    if (daysSince <= 7) return 'FRESH';
    if (daysSince <= 30) return 'STALE';
    return 'OLD';
  } else if (frequency === 'monthly') {
    if (daysSince <= 45) return 'FRESH';
    if (daysSince <= 90) return 'STALE';
    return 'OLD';
  }
  
  if (daysSince <= 14) return 'FRESH';
  if (daysSince <= 45) return 'STALE';
  return 'OLD';
}

/**
 * P3: Build contexts for all series as of a specific date
 */
export async function buildAllMacroContextsAsOf(asOfDate: string): Promise<MacroContext[]> {
  const metas = await getAllSeriesMeta();
  const contexts: MacroContext[] = [];
  
  for (const meta of metas) {
    const ctx = await buildMacroContextAsOf(meta.seriesId, asOfDate);
    if (ctx) {
      contexts.push(ctx);
    }
  }
  
  return contexts;
}
