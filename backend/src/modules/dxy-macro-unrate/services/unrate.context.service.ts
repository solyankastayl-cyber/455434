/**
 * UNRATE CONTEXT SERVICE — D6 v3
 * 
 * Computes unemployment rate context metrics.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only computes UNRATE metrics for macro adjustment.
 */

import { UnratePointModel, UnrateCacheModel } from '../storage/unrate.model.js';
import { UNRATE_SERIES, UNRATE_CONFIG, UnrateContext, UnrateTrend, UnrateRegime } from '../unrate.types.js';

// ═══════════════════════════════════════════════════════════════
// DETERMINE TREND
// ═══════════════════════════════════════════════════════════════

function determineTrend(delta3m: number): UnrateTrend {
  if (delta3m > UNRATE_CONFIG.TREND_UP_THRESHOLD) return 'UP';
  if (delta3m < UNRATE_CONFIG.TREND_DOWN_THRESHOLD) return 'DOWN';
  return 'FLAT';
}

// ═══════════════════════════════════════════════════════════════
// DETERMINE REGIME
// ═══════════════════════════════════════════════════════════════

function determineRegime(current: number): UnrateRegime {
  if (current <= UNRATE_CONFIG.TIGHT_THRESHOLD) return 'TIGHT';
  if (current > UNRATE_CONFIG.STRESS_THRESHOLD) return 'STRESS';
  return 'NORMAL';
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE PRESSURE
// ═══════════════════════════════════════════════════════════════

function computePressure(delta12m: number): number {
  // Rising unemployment = risk-off = DXY support = positive pressure
  // Falling unemployment = risk-on = DXY pressure = negative pressure
  const raw = delta12m / UNRATE_CONFIG.PRESSURE_SCALE;
  return Math.max(-1, Math.min(1, raw));
}

// ═══════════════════════════════════════════════════════════════
// GET UNRATE CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function getUnrateContext(asOf?: Date): Promise<UnrateContext> {
  const targetDate = asOf || new Date();
  
  // Get all points up to asOf, sorted descending (newest first)
  const points = await UnratePointModel
    .find({ seriesId: UNRATE_SERIES, date: { $lte: targetDate } })
    .sort({ date: -1 })
    .limit(15)
    .lean();
  
  if (points.length < 13) {
    throw new Error(`Not enough UNRATE data: have ${points.length}, need 13`);
  }
  
  // Points are sorted newest first
  const current = points[0].value;
  const prev3m = points[3]?.value || current;
  const prev12m = points[12]?.value || current;
  
  // Calculate deltas (percentage points)
  const delta3m = Math.round((current - prev3m) * 100) / 100;
  const delta12m = Math.round((current - prev12m) * 100) / 100;
  
  // Determine trend and regime
  const trend = determineTrend(delta3m);
  const regime = determineRegime(current);
  
  // Compute pressure
  const pressure = Math.round(computePressure(delta12m) * 1000) / 1000;
  
  // Get total count
  const dataPoints = await UnratePointModel.countDocuments({ seriesId: UNRATE_SERIES });
  
  const context: UnrateContext = {
    current: Math.round(current * 100) / 100,
    delta3m,
    delta12m,
    trend,
    regime,
    pressure,
    asOf: points[0].date.toISOString().split('T')[0],
    dataPoints,
  };
  
  // Cache the computed context
  await UnrateCacheModel.updateOne(
    { asOfDate: points[0].date },
    { $set: context },
    { upsert: true }
  );
  
  return context;
}

// ═══════════════════════════════════════════════════════════════
// GET UNRATE HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getUnrateHistory(months: number = 120): Promise<Array<{
  date: string;
  value: number;
}>> {
  const points = await UnratePointModel
    .find({ seriesId: UNRATE_SERIES })
    .sort({ date: -1 })
    .limit(months)
    .lean();
  
  return points
    .map(p => ({
      date: p.date.toISOString().split('T')[0],
      value: p.value,
    }))
    .reverse();
}
