/**
 * HOUSING CONTEXT SERVICE — B4.1 + P3.2 (As-Of)
 * 
 * Computes context and pressure for housing & real estate series:
 * - MORTGAGE30US: 30Y Mortgage Rate
 * - HOUST: Housing Starts
 * - PERMIT: Building Permits
 * - CSUSHPISA: Case-Shiller Home Price Index
 * 
 * P3.2: Supports as-of queries for honest backtesting.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { getMacroSeriesPoints, getLatestMacroPoint } from '../ingest/macro.ingest.service.js';
import { getMacroSeriesSpec } from '../data/macro_sources.registry.js';
import { filterByAsOf } from '../../macro-asof/asof.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HousingTrend = 'UP' | 'DOWN' | 'FLAT';

export type MortgageRegime = 'TIGHTENING' | 'EASING' | 'NEUTRAL';
export type StartsRegime = 'EXPANSION' | 'CONTRACTION' | 'NEUTRAL';
export type HomePriceRegime = 'OVERHEATING' | 'COOLING' | 'NEUTRAL';

export interface HousingSeriesContext {
  seriesId: string;
  displayName: string;
  available: boolean;
  
  // Current state
  current: {
    value: number;
    date: string;
  } | null;
  
  // Deltas
  deltas: {
    delta3m: number | null;
    delta12m: number | null;
  };
  
  // Stats (5-year rolling)
  stats: {
    mean5y: number;
    std5y: number;
    z5y: number;
  } | null;
  
  // Regime and pressure
  trend: HousingTrend;
  regime: string;
  pressure: number;  // -1..+1 (+ = USD supportive)
}

export interface HousingContext {
  mortgage: HousingSeriesContext;
  starts: HousingSeriesContext;
  permits: HousingSeriesContext;
  homePrice: HousingSeriesContext;
  
  // Composite
  composite: {
    scoreSigned: number;  // -1..+1
    confidence: number;   // 0..1
    regime: string;       // TIGHT / LOOSE / NEUTRAL
    note: string;
  };
  
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const HOUSING_SERIES = ['MORTGAGE30US', 'HOUST', 'PERMIT', 'CSUSHPISA'];

// Weights for composite
const WEIGHTS = {
  MORTGAGE30US: 0.40,
  HOUST: 0.20,
  PERMIT: 0.20,
  CSUSHPISA: 0.20,
};

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
// TRANSFORM HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Convert weekly data to monthly averages
 */
function toMonthlyAverage(
  points: Array<{ date: string; value: number }>
): Array<{ date: string; value: number }> {
  const byMonth = new Map<string, number[]>();
  
  for (const p of points) {
    const monthKey = p.date.substring(0, 7);  // YYYY-MM
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, []);
    }
    byMonth.get(monthKey)!.push(p.value);
  }
  
  const result: Array<{ date: string; value: number }> = [];
  for (const [month, values] of byMonth) {
    result.push({
      date: month + '-15',  // Mid-month
      value: mean(values),
    });
  }
  
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Compute YoY (Year-over-Year) change
 */
function computeYoY(
  points: Array<{ date: string; value: number }>,
  current: number
): number | null {
  if (points.length < 12) return null;
  
  // Find point ~12 months ago
  const lastDate = points[points.length - 1].date;
  const targetDate = new Date(lastDate);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  const targetStr = targetDate.toISOString().split('T')[0];
  
  // Find closest point
  let closest = points[0];
  for (const p of points) {
    if (p.date <= targetStr) {
      closest = p;
    } else {
      break;
    }
  }
  
  if (closest.value === 0) return null;
  return (current - closest.value) / Math.abs(closest.value);
}

/**
 * Compute delta (change over N months)
 */
function computeDelta(
  points: Array<{ date: string; value: number }>,
  current: number,
  months: number
): number | null {
  if (points.length < months) return null;
  
  const index = Math.max(0, points.length - months - 1);
  const past = points[index].value;
  
  return current - past;
}

/**
 * Compute rolling 5-year stats
 */
function compute5YearStats(
  points: Array<{ date: string; value: number }>,
  current: number
): { mean5y: number; std5y: number; z5y: number } | null {
  // Need at least 60 months for 5y stats
  if (points.length < 60) return null;
  
  const last5y = points.slice(-60).map(p => p.value);
  const m = mean(last5y);
  const sd = stdDev(last5y);
  
  if (sd === 0) return { mean5y: m, std5y: 0, z5y: 0 };
  
  return {
    mean5y: Math.round(m * 1000) / 1000,
    std5y: Math.round(sd * 1000) / 1000,
    z5y: Math.round(((current - m) / sd) * 1000) / 1000,
  };
}

// ═══════════════════════════════════════════════════════════════
// TREND CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyTrend(delta3m: number | null, std5y: number): HousingTrend {
  if (delta3m === null || std5y === 0) return 'FLAT';
  
  const threshold = std5y * 0.5;
  if (delta3m > threshold) return 'UP';
  if (delta3m < -threshold) return 'DOWN';
  return 'FLAT';
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION (by series)
// ═══════════════════════════════════════════════════════════════

function classifyMortgageRegime(delta3m: number | null): MortgageRegime {
  if (delta3m === null) return 'NEUTRAL';
  if (delta3m > 0.5) return 'TIGHTENING';  // +0.5pp
  if (delta3m < -0.5) return 'EASING';     // -0.5pp
  return 'NEUTRAL';
}

function classifyStartsRegime(delta12m: number | null): StartsRegime {
  if (delta12m === null) return 'NEUTRAL';
  if (delta12m < -0.05) return 'CONTRACTION';  // -5% YoY
  if (delta12m > 0.05) return 'EXPANSION';     // +5% YoY
  return 'NEUTRAL';
}

function classifyHomePriceRegime(delta12m: number | null): HomePriceRegime {
  if (delta12m === null) return 'NEUTRAL';
  if (delta12m > 0.06) return 'OVERHEATING';  // +6% YoY
  if (delta12m < 0) return 'COOLING';          // <0% YoY
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// PRESSURE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Mortgage pressure: high rates → tight → risk-off → USD supportive (+)
 */
function calcMortgagePressure(z5y: number | null): number {
  if (z5y === null) return 0;
  return clamp(z5y / 3, -1, 1);
}

/**
 * Starts pressure: strong starts → growth → risk-on → USD pressure (-)
 */
function calcStartsPressure(z5y: number | null): number {
  if (z5y === null) return 0;
  return -clamp(z5y / 3, -1, 1);
}

/**
 * Permits pressure: same as starts
 */
function calcPermitsPressure(z5y: number | null): number {
  if (z5y === null) return 0;
  return -clamp(z5y / 3, -1, 1);
}

/**
 * Home price pressure: rising prices → wealth effect → risk-on → USD pressure (-)
 */
function calcHomePricePressure(z5y: number | null): number {
  if (z5y === null) return 0;
  return -clamp(z5y / 3, -1, 1);
}

// ═══════════════════════════════════════════════════════════════
// BUILD SINGLE SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

async function buildSeriesContext(
  seriesId: string,
  calcPressure: (z5y: number | null) => number,
  classifyRegime: (delta: number | null) => string,
  regimeDeltaType: '3m' | '12m' = '12m'
): Promise<HousingSeriesContext> {
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? seriesId;
  
  try {
    // Get all points
    let points = await getMacroSeriesPoints(seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Convert weekly to monthly if needed
    if (spec?.frequency === 'weekly') {
      points = toMonthlyAverage(points);
    }
    
    // Get current value
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    // Compute deltas
    const delta3m = computeDelta(points, current, 3);
    const delta12m = computeYoY(points, current);
    
    // Compute 5y stats
    const stats = compute5YearStats(points, current);
    const z5y = stats?.z5y ?? null;
    
    // Classify trend
    const trend = classifyTrend(delta3m, stats?.std5y ?? 0);
    
    // Classify regime (use appropriate delta)
    const regimeDelta = regimeDeltaType === '3m' ? delta3m : delta12m;
    const regime = classifyRegime(regimeDelta);
    
    // Calculate pressure
    const pressure = calcPressure(z5y);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: {
        value: Math.round(current * 1000) / 1000,
        date: currentDate,
      },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 10000) / 10000 : null,
        delta12m: delta12m !== null ? Math.round(delta12m * 10000) / 10000 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
    
  } catch (error: any) {
    console.error(`[Housing] Failed to build context for ${seriesId}:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

function buildEmptyContext(seriesId: string, displayName: string): HousingSeriesContext {
  return {
    seriesId,
    displayName,
    available: false,
    current: null,
    deltas: { delta3m: null, delta12m: null },
    stats: null,
    trend: 'FLAT',
    regime: 'NEUTRAL',
    pressure: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// P3.2: AS-OF SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * P3.2: Build series context as of a specific date
 */
async function buildSeriesContextAsOf(
  seriesId: string,
  asOfDate: string,
  calcPressure: (z5y: number | null) => number,
  classifyRegime: (delta: number | null) => string,
  regimeDeltaType: '3m' | '12m' = '12m'
): Promise<HousingSeriesContext> {
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? seriesId;
  
  try {
    // Get all points
    let rawPoints = await getMacroSeriesPoints(seriesId);
    
    // P3.2: Filter by publication lag
    let points = filterByAsOf(rawPoints, asOfDate, seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    // Convert weekly to monthly if needed
    if (spec?.frequency === 'weekly') {
      points = toMonthlyAverage(points);
    }
    
    // Get current value (latest available)
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    // Compute deltas
    const delta3m = computeDelta(points, current, 3);
    const delta12m = computeYoY(points, current);
    
    // Compute 5y stats
    const stats = compute5YearStats(points, current);
    const z5y = stats?.z5y ?? null;
    
    // Classify trend
    const trend = classifyTrend(delta3m, stats?.std5y ?? 0);
    
    // Classify regime (use appropriate delta)
    const regimeDelta = regimeDeltaType === '3m' ? delta3m : delta12m;
    const regime = classifyRegime(regimeDelta);
    
    // Calculate pressure
    const pressure = calcPressure(z5y);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: {
        value: Math.round(current * 1000) / 1000,
        date: currentDate,
      },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 10000) / 10000 : null,
        delta12m: delta12m !== null ? Math.round(delta12m * 10000) / 10000 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
    
  } catch (error: any) {
    console.error(`[Housing AsOf] Failed to build context for ${seriesId}:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

// ═══════════════════════════════════════════════════════════════
// BUILD COMPOSITE HOUSING CONTEXT
// ═══════════════════════════════════════════════════════════════

/**
 * Build complete housing context with composite score
 */
export async function buildHousingContext(): Promise<HousingContext> {
  // Build individual contexts
  const mortgage = await buildSeriesContext(
    'MORTGAGE30US',
    calcMortgagePressure,
    classifyMortgageRegime,
    '3m'
  );
  
  const starts = await buildSeriesContext(
    'HOUST',
    calcStartsPressure,
    classifyStartsRegime,
    '12m'
  );
  
  const permits = await buildSeriesContext(
    'PERMIT',
    calcPermitsPressure,
    classifyStartsRegime,  // Same logic as starts
    '12m'
  );
  
  const homePrice = await buildSeriesContext(
    'CSUSHPISA',
    calcHomePricePressure,
    classifyHomePriceRegime,
    '12m'
  );
  
  // Calculate composite score
  const pressures = [
    { weight: WEIGHTS.MORTGAGE30US, pressure: mortgage.pressure, available: mortgage.available },
    { weight: WEIGHTS.HOUST, pressure: starts.pressure, available: starts.available },
    { weight: WEIGHTS.PERMIT, pressure: permits.pressure, available: permits.available },
    { weight: WEIGHTS.CSUSHPISA, pressure: homePrice.pressure, available: homePrice.available },
  ];
  
  // Filter available
  const available = pressures.filter(p => p.available);
  
  let scoreSigned = 0;
  let totalWeight = 0;
  
  if (available.length > 0) {
    for (const p of available) {
      scoreSigned += p.pressure * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      scoreSigned = scoreSigned / totalWeight;  // Normalize
      scoreSigned = scoreSigned * (totalWeight / (WEIGHTS.MORTGAGE30US + WEIGHTS.HOUST + WEIGHTS.PERMIT + WEIGHTS.CSUSHPISA));  // Scale by coverage
    }
  }
  
  scoreSigned = clamp(scoreSigned, -1, 1);
  
  // Calculate confidence (inverse of variance)
  const availablePressures = available.map(p => p.pressure);
  const pressureStd = stdDev(availablePressures);
  const confidence = clamp(1 - pressureStd, 0.3, 1);
  
  // Determine composite regime
  let regime: string;
  if (scoreSigned > 0.2) {
    regime = 'TIGHT';  // High rates, weak housing → USD supportive
  } else if (scoreSigned < -0.2) {
    regime = 'LOOSE';  // Low rates, strong housing → USD pressure
  } else {
    regime = 'NEUTRAL';
  }
  
  // Build note
  let note: string;
  if (regime === 'TIGHT') {
    note = 'Tight mortgage + weak construction → USD supportive';
  } else if (regime === 'LOOSE') {
    note = 'Easing housing cycle → USD pressure';
  } else {
    note = 'Housing conditions neutral';
  }
  
  return {
    mortgage,
    starts,
    permits,
    homePrice,
    composite: {
      scoreSigned: Math.round(scoreSigned * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      regime,
      note,
    },
    computedAt: new Date().toISOString(),
  };
}

/**
 * Get housing score for macro score integration
 */
export async function getHousingScoreComponent(): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: string;
  available: boolean;
}> {
  const ctx = await buildHousingContext();
  
  const anyAvailable = ctx.mortgage.available || ctx.starts.available || 
                       ctx.permits.available || ctx.homePrice.available;
  
  return {
    key: 'HOUSING',
    displayName: 'Housing & Mortgage Conditions',
    scoreSigned: ctx.composite.scoreSigned,
    weight: 0.15,  // 15% weight in macro score
    confidence: ctx.composite.confidence,
    regime: ctx.composite.regime,
    available: anyAvailable,
  };
}

/**
 * P3: Get housing score as of a specific date.
 * P3.2: Full implementation with publication lag
 */
export async function getHousingScoreComponentAsOf(asOfDate: string): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: string;
  available: boolean;
}> {
  const ctx = await buildHousingContextAsOf(asOfDate);
  
  const anyAvailable = ctx.mortgage.available || ctx.starts.available || 
                       ctx.permits.available || ctx.homePrice.available;
  
  return {
    key: 'HOUSING',
    displayName: 'Housing & Mortgage Conditions',
    scoreSigned: ctx.composite.scoreSigned,
    weight: 0.15,
    confidence: ctx.composite.confidence,
    regime: ctx.composite.regime,
    available: anyAvailable,
  };
}

/**
 * P3.2: Build complete housing context as of a specific date
 */
export async function buildHousingContextAsOf(asOfDate: string): Promise<HousingContext> {
  // Build individual contexts with as-of filtering
  const mortgage = await buildSeriesContextAsOf(
    'MORTGAGE30US',
    asOfDate,
    calcMortgagePressure,
    classifyMortgageRegime,
    '3m'
  );
  
  const starts = await buildSeriesContextAsOf(
    'HOUST',
    asOfDate,
    calcStartsPressure,
    classifyStartsRegime,
    '12m'
  );
  
  const permits = await buildSeriesContextAsOf(
    'PERMIT',
    asOfDate,
    calcPermitsPressure,
    classifyStartsRegime,
    '12m'
  );
  
  const homePrice = await buildSeriesContextAsOf(
    'CSUSHPISA',
    asOfDate,
    calcHomePricePressure,
    classifyHomePriceRegime,
    '12m'
  );
  
  // Calculate composite score (same logic as current)
  const pressures = [
    { weight: WEIGHTS.MORTGAGE30US, pressure: mortgage.pressure, available: mortgage.available },
    { weight: WEIGHTS.HOUST, pressure: starts.pressure, available: starts.available },
    { weight: WEIGHTS.PERMIT, pressure: permits.pressure, available: permits.available },
    { weight: WEIGHTS.CSUSHPISA, pressure: homePrice.pressure, available: homePrice.available },
  ];
  
  const available = pressures.filter(p => p.available);
  
  let scoreSigned = 0;
  let totalWeight = 0;
  
  if (available.length > 0) {
    for (const p of available) {
      scoreSigned += p.pressure * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      scoreSigned = scoreSigned / totalWeight;
      scoreSigned = scoreSigned * (totalWeight / (WEIGHTS.MORTGAGE30US + WEIGHTS.HOUST + WEIGHTS.PERMIT + WEIGHTS.CSUSHPISA));
    }
  }
  
  scoreSigned = clamp(scoreSigned, -1, 1);
  
  const availablePressures = available.map(p => p.pressure);
  const pressureStd = stdDev(availablePressures);
  const confidence = clamp(1 - pressureStd, 0.3, 1);
  
  let regime: string;
  if (scoreSigned > 0.2) {
    regime = 'TIGHT';
  } else if (scoreSigned < -0.2) {
    regime = 'LOOSE';
  } else {
    regime = 'NEUTRAL';
  }
  
  let note: string;
  if (regime === 'TIGHT') {
    note = 'Tight mortgage + weak construction → USD supportive';
  } else if (regime === 'LOOSE') {
    note = 'Easing housing cycle → USD pressure';
  } else {
    note = 'Housing conditions neutral';
  }
  
  return {
    mortgage,
    starts,
    permits,
    homePrice,
    composite: {
      scoreSigned: Math.round(scoreSigned * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      regime,
      note,
    },
    computedAt: asOfDate,
  };
}
