/**
 * ACTIVITY CONTEXT SERVICE — B4.2 + P3.2 (As-Of)
 * 
 * Computes context and pressure for PMI & economic activity series:
 * - NAPM: ISM Manufacturing PMI
 * - INDPRO: Industrial Production
 * - TCU: Capacity Utilization
 * 
 * P3.2: Supports as-of queries for honest backtesting.
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

import { getMacroSeriesPoints } from '../ingest/macro.ingest.service.js';
import { getMacroSeriesSpec } from '../data/macro_sources.registry.js';
import { filterByAsOf } from '../../macro-asof/asof.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type ActivityTrend = 'UP' | 'DOWN' | 'FLAT';
export type ActivityRegime = 'EXPANSION' | 'CONTRACTION' | 'NEUTRAL';

export interface ActivitySeriesContext {
  seriesId: string;
  displayName: string;
  available: boolean;
  
  current: {
    value: number;
    date: string;
  } | null;
  
  deltas: {
    delta3m: number | null;
    delta12m: number | null;
  };
  
  stats: {
    mean5y: number;
    std5y: number;
    z5y: number;
  } | null;
  
  trend: ActivityTrend;
  regime: ActivityRegime;
  pressure: number;  // -1..+1
}

export interface ActivityContext {
  manemp: ActivitySeriesContext;
  indpro: ActivitySeriesContext;
  tcu: ActivitySeriesContext;
  
  composite: {
    scoreSigned: number;  // -1..+1 (negative = strong activity = USD supportive)
    confidence: number;   // 0..1
    regime: string;
    note: string;
  };
  
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const WEIGHTS = {
  MANEMP: 0.35,  // Manufacturing Employment (replaces NAPM)
  INDPRO: 0.40,
  TCU: 0.25,
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

function computeDelta(
  points: Array<{ date: string; value: number }>,
  current: number,
  months: number
): number | null {
  if (points.length < months) return null;
  const index = Math.max(0, points.length - months - 1);
  return current - points[index].value;
}

function computeYoY(
  points: Array<{ date: string; value: number }>,
  current: number
): number | null {
  if (points.length < 12) return null;
  
  const lastDate = points[points.length - 1].date;
  const targetDate = new Date(lastDate);
  targetDate.setFullYear(targetDate.getFullYear() - 1);
  const targetStr = targetDate.toISOString().split('T')[0];
  
  let closest = points[0];
  for (const p of points) {
    if (p.date <= targetStr) closest = p;
    else break;
  }
  
  if (closest.value === 0) return null;
  return (current - closest.value) / Math.abs(closest.value);
}

function compute5YearStats(
  points: Array<{ date: string; value: number }>,
  current: number
): { mean5y: number; std5y: number; z5y: number } | null {
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

function classifyTrend(delta3m: number | null, threshold: number = 1): ActivityTrend {
  if (delta3m === null) return 'FLAT';
  if (delta3m > threshold) return 'UP';
  if (delta3m < -threshold) return 'DOWN';
  return 'FLAT';
}

// ═══════════════════════════════════════════════════════════════
// REGIME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Manufacturing Employment regime: based on YoY
 * > +2% = EXPANSION, -2..+2% = NEUTRAL, < -2% = CONTRACTION
 */
function classifyManempRegime(yoy: number | null): ActivityRegime {
  if (yoy === null) return 'NEUTRAL';
  if (yoy > 0.02) return 'EXPANSION';
  if (yoy < -0.02) return 'CONTRACTION';
  return 'NEUTRAL';
}

/**
 * Industrial Production regime: based on YoY
 * >+2% = EXPANSION, -2..+2% = NEUTRAL, <-2% = CONTRACTION
 */
function classifyIndproRegime(yoy: number | null): ActivityRegime {
  if (yoy === null) return 'NEUTRAL';
  if (yoy > 0.02) return 'EXPANSION';
  if (yoy < -0.02) return 'CONTRACTION';
  return 'NEUTRAL';
}

/**
 * Capacity Utilization regime: based on level
 * >80% = EXPANSION, 75-80% = NEUTRAL, <75% = CONTRACTION
 */
function classifyTcuRegime(value: number): ActivityRegime {
  if (value >= 80) return 'EXPANSION';
  if (value < 75) return 'CONTRACTION';
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// PRESSURE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Manufacturing Employment pressure: YoY / 5%, clamped to -1..+1
 * Strong employment growth = expansion = USD supportive
 */
function calcManempPressure(yoy: number | null): number {
  if (yoy === null) return 0;
  return clamp(yoy / 0.05, -1, 1);  // 5% YoY = max pressure
}

/**
 * INDPRO pressure: YoY / 10, clamped to -1..+1
 */
function calcIndproPressure(yoy: number | null): number {
  if (yoy === null) return 0;
  return clamp(yoy / 0.10, -1, 1);  // 10% YoY = max pressure
}

/**
 * TCU pressure: (value - 77.5) / 7.5, clamped to -1..+1
 * 77.5 = historical average
 */
function calcTcuPressure(value: number): number {
  return clamp((value - 77.5) / 7.5, -1, 1);
}

// ═══════════════════════════════════════════════════════════════
// BUILD SINGLE SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

async function buildManempContext(): Promise<ActivitySeriesContext> {
  const seriesId = 'MANEMP';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Manufacturing Employment';
  
  try {
    const points = await getMacroSeriesPoints(seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const yoy = computeYoY(points, current);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, stats?.std5y ?? 50);
    const regime = classifyManempRegime(yoy);
    const pressure = calcManempPressure(yoy);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current), date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m) : null,
        delta12m: yoy !== null ? Math.round(yoy * 10000) / 10000 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity] Failed to build MANEMP context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

async function buildIndproContext(): Promise<ActivitySeriesContext> {
  const seriesId = 'INDPRO';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Industrial Production';
  
  try {
    const points = await getMacroSeriesPoints(seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const yoy = computeYoY(points, current);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, stats?.std5y ?? 1);
    const regime = classifyIndproRegime(yoy);
    const pressure = calcIndproPressure(yoy);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current * 100) / 100, date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 100) / 100 : null,
        delta12m: yoy !== null ? Math.round(yoy * 10000) / 10000 : null,  // YoY as decimal
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity] Failed to build INDPRO context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

async function buildTcuContext(): Promise<ActivitySeriesContext> {
  const seriesId = 'TCU';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Capacity Utilization';
  
  try {
    const points = await getMacroSeriesPoints(seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const delta12m = computeDelta(points, current, 12);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, 1);
    const regime = classifyTcuRegime(current);
    const pressure = calcTcuPressure(current);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current * 100) / 100, date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 100) / 100 : null,
        delta12m: delta12m !== null ? Math.round(delta12m * 100) / 100 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity] Failed to build TCU context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

function buildEmptyContext(seriesId: string, displayName: string): ActivitySeriesContext {
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

async function buildManempContextAsOf(asOfDate: string): Promise<ActivitySeriesContext> {
  const seriesId = 'MANEMP';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Manufacturing Employment';
  
  try {
    const rawPoints = await getMacroSeriesPoints(seriesId);
    const points = filterByAsOf(rawPoints, asOfDate, seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const yoy = computeYoY(points, current);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, stats?.std5y ?? 50);
    const regime = classifyManempRegime(yoy);
    const pressure = calcManempPressure(yoy);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current), date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m) : null,
        delta12m: yoy !== null ? Math.round(yoy * 10000) / 10000 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity AsOf] Failed to build MANEMP context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

async function buildIndproContextAsOf(asOfDate: string): Promise<ActivitySeriesContext> {
  const seriesId = 'INDPRO';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Industrial Production';
  
  try {
    const rawPoints = await getMacroSeriesPoints(seriesId);
    const points = filterByAsOf(rawPoints, asOfDate, seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const yoy = computeYoY(points, current);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, stats?.std5y ?? 1);
    const regime = classifyIndproRegime(yoy);
    const pressure = calcIndproPressure(yoy);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current * 100) / 100, date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 100) / 100 : null,
        delta12m: yoy !== null ? Math.round(yoy * 10000) / 10000 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity AsOf] Failed to build INDPRO context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

async function buildTcuContextAsOf(asOfDate: string): Promise<ActivitySeriesContext> {
  const seriesId = 'TCU';
  const spec = getMacroSeriesSpec(seriesId);
  const displayName = spec?.displayName ?? 'Capacity Utilization';
  
  try {
    const rawPoints = await getMacroSeriesPoints(seriesId);
    const points = filterByAsOf(rawPoints, asOfDate, seriesId);
    
    if (points.length === 0) {
      return buildEmptyContext(seriesId, displayName);
    }
    
    const latestPoint = points[points.length - 1];
    const current = latestPoint.value;
    const currentDate = latestPoint.date;
    
    const delta3m = computeDelta(points, current, 3);
    const delta12m = computeDelta(points, current, 12);
    const stats = compute5YearStats(points, current);
    
    const trend = classifyTrend(delta3m, 1);
    const regime = classifyTcuRegime(current);
    const pressure = calcTcuPressure(current);
    
    return {
      seriesId,
      displayName,
      available: true,
      current: { value: Math.round(current * 100) / 100, date: currentDate },
      deltas: {
        delta3m: delta3m !== null ? Math.round(delta3m * 100) / 100 : null,
        delta12m: delta12m !== null ? Math.round(delta12m * 100) / 100 : null,
      },
      stats,
      trend,
      regime,
      pressure: Math.round(pressure * 1000) / 1000,
    };
  } catch (error: any) {
    console.error(`[Activity AsOf] Failed to build TCU context:`, error.message);
    return buildEmptyContext(seriesId, displayName);
  }
}

/**
 * P3.2: Build complete activity context as of a specific date
 */
export async function buildActivityContextAsOf(asOfDate: string): Promise<ActivityContext> {
  const manemp = await buildManempContextAsOf(asOfDate);
  const indpro = await buildIndproContextAsOf(asOfDate);
  const tcu = await buildTcuContextAsOf(asOfDate);
  
  // Calculate composite score (same logic as current)
  const pressures = [
    { weight: WEIGHTS.MANEMP, pressure: manemp.pressure, available: manemp.available },
    { weight: WEIGHTS.INDPRO, pressure: indpro.pressure, available: indpro.available },
    { weight: WEIGHTS.TCU, pressure: tcu.pressure, available: tcu.available },
  ];
  
  const available = pressures.filter(p => p.available);
  const missingCount = 3 - available.length;
  
  let scoreSigned = 0;
  let totalWeight = 0;
  
  if (available.length > 0) {
    for (const p of available) {
      scoreSigned += p.pressure * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      scoreSigned = scoreSigned / totalWeight;
    }
  }
  
  scoreSigned = clamp(scoreSigned, -1, 1);
  
  // Confidence based on missing series and pressure agreement
  let confidence: number;
  if (missingCount >= 2) {
    confidence = 0.35;
  } else if (missingCount === 1) {
    confidence = 0.55;
  } else {
    const availablePressures = available.map(p => p.pressure);
    const pressureStd = stdDev(availablePressures);
    confidence = clamp(1 - pressureStd, 0.3, 1);
  }
  
  // Determine composite regime
  let regime: string;
  const regimes = [manemp.regime, indpro.regime, tcu.regime].filter(r => r !== 'NEUTRAL');
  const expansionCount = regimes.filter(r => r === 'EXPANSION').length;
  const contractionCount = regimes.filter(r => r === 'CONTRACTION').length;
  
  if (expansionCount > contractionCount) {
    regime = 'EXPANSION';
  } else if (contractionCount > expansionCount) {
    regime = 'CONTRACTION';
  } else {
    regime = 'NEUTRAL';
  }
  
  // Build note
  let note: string;
  if (regime === 'EXPANSION') {
    note = 'Economic activity expanding → USD tailwind from growth';
  } else if (regime === 'CONTRACTION') {
    note = 'Economic activity contracting → USD headwind from weakness';
  } else {
    note = 'Economic activity neutral';
  }
  
  return {
    manemp,
    indpro,
    tcu,
    composite: {
      scoreSigned: Math.round(scoreSigned * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      regime,
      note,
    },
    computedAt: asOfDate,
  };
}

// ═══════════════════════════════════════════════════════════════
// BUILD COMPOSITE ACTIVITY CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function buildActivityContext(): Promise<ActivityContext> {
  const manemp = await buildManempContext();
  const indpro = await buildIndproContext();
  const tcu = await buildTcuContext();
  
  // Calculate composite score
  const pressures = [
    { weight: WEIGHTS.MANEMP, pressure: manemp.pressure, available: manemp.available },
    { weight: WEIGHTS.INDPRO, pressure: indpro.pressure, available: indpro.available },
    { weight: WEIGHTS.TCU, pressure: tcu.pressure, available: tcu.available },
  ];
  
  const available = pressures.filter(p => p.available);
  const missingCount = 3 - available.length;
  
  let scoreSigned = 0;
  let totalWeight = 0;
  
  if (available.length > 0) {
    for (const p of available) {
      // Strong activity (positive pressure) = USD supportive (positive score)
      scoreSigned += p.pressure * p.weight;
      totalWeight += p.weight;
    }
    if (totalWeight > 0) {
      scoreSigned = scoreSigned / totalWeight;
    }
  }
  
  scoreSigned = clamp(scoreSigned, -1, 1);
  
  // Confidence based on missing series and pressure agreement
  let confidence: number;
  if (missingCount >= 2) {
    confidence = 0.35;
  } else if (missingCount === 1) {
    confidence = 0.55;
  } else {
    const availablePressures = available.map(p => p.pressure);
    const pressureStd = stdDev(availablePressures);
    confidence = clamp(1 - pressureStd, 0.3, 1);
  }
  
  // Determine composite regime
  let regime: string;
  const regimes = [manemp.regime, indpro.regime, tcu.regime].filter(r => r !== 'NEUTRAL');
  const expansionCount = regimes.filter(r => r === 'EXPANSION').length;
  const contractionCount = regimes.filter(r => r === 'CONTRACTION').length;
  
  if (expansionCount > contractionCount) {
    regime = 'EXPANSION';
  } else if (contractionCount > expansionCount) {
    regime = 'CONTRACTION';
  } else {
    regime = 'NEUTRAL';
  }
  
  // Build note
  let note: string;
  if (regime === 'EXPANSION') {
    note = 'Economic activity expanding → USD tailwind from growth';
  } else if (regime === 'CONTRACTION') {
    note = 'Economic activity contracting → USD headwind from weakness';
  } else {
    note = 'Economic activity neutral';
  }
  
  return {
    manemp,
    indpro,
    tcu,
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
 * Get activity score component for macro score integration
 */
export async function getActivityScoreComponent(): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: string;
  available: boolean;
}> {
  const ctx = await buildActivityContext();
  
  const anyAvailable = ctx.manemp.available || ctx.indpro.available || ctx.tcu.available;
  
  return {
    key: 'ACTIVITY',
    displayName: 'Economic Activity (PMI/Production)',
    scoreSigned: ctx.composite.scoreSigned,
    weight: 0.15,
    confidence: ctx.composite.confidence,
    regime: ctx.composite.regime,
    available: anyAvailable,
  };
}

/**
 * P3.2: Get activity score as of a specific date.
 * Full implementation with publication lag filtering.
 */
export async function getActivityScoreComponentAsOf(asOfDate: string): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: string;
  available: boolean;
}> {
  const ctx = await buildActivityContextAsOf(asOfDate);
  
  const anyAvailable = ctx.manemp.available || ctx.indpro.available || ctx.tcu.available;
  
  return {
    key: 'ACTIVITY',
    displayName: 'Economic Activity (PMI/Production)',
    scoreSigned: ctx.composite.scoreSigned,
    weight: 0.15,
    confidence: ctx.composite.confidence,
    regime: ctx.composite.regime,
    available: anyAvailable,
  };
}
