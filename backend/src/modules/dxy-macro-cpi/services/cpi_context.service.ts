/**
 * CPI CONTEXT SERVICE — D6 v2
 * 
 * Computes CPI context metrics from raw data.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only computes CPI metrics for macro adjustment.
 */

import { CpiPointModel, CpiCacheModel } from '../storage/cpi.model.js';
import { CPI_SERIES, CpiContext, CpiMetrics, CpiRegime, CPI_CONFIG } from '../contracts/cpi.contract.js';

// ═══════════════════════════════════════════════════════════════
// COMPUTE METRICS FOR SINGLE SERIES
// ═══════════════════════════════════════════════════════════════

async function computeSeriesMetrics(seriesId: string, asOf?: Date): Promise<CpiMetrics | null> {
  const targetDate = asOf || new Date();
  
  // Get all points up to asOf, sorted descending (newest first)
  const points = await CpiPointModel
    .find({ seriesId, date: { $lte: targetDate } })
    .sort({ date: -1 })
    .limit(15) // Need 13 for YoY + 3 for trend
    .lean();
  
  if (points.length < 13) {
    return null;
  }
  
  // Points are sorted newest first: [0] = latest, [1] = 1 month ago, etc.
  const latest = points[0];
  const prev1m = points[1];
  const prev3m = points[3];
  const prev12m = points[12];
  
  // YoY and 3-month ago YoY for trend calculation
  const prev3m_yoy_base = points[15] || points[points.length - 1]; // 15 months ago if available
  
  // Calculate metrics
  const yoy = (latest.value / prev12m.value) - 1;
  const mom = (latest.value / prev1m.value) - 1;
  const ann3m = Math.pow(latest.value / prev3m.value, 12/3) - 1;
  
  // Trend: YoY change over last 3 months
  // We need YoY from 3 months ago
  let yoy3mAgo = 0;
  if (points.length >= 15) {
    const prev3m_val = points[3];
    const prev15m_val = points[15];
    if (prev15m_val) {
      yoy3mAgo = (prev3m_val.value / prev15m_val.value) - 1;
    }
  }
  const trendYoy3m = yoy - yoy3mAgo;
  
  return {
    latestValue: Math.round(latest.value * 1000) / 1000,
    latestDate: latest.date.toISOString().split('T')[0],
    yoy: Math.round(yoy * 10000) / 10000,
    mom: Math.round(mom * 10000) / 10000,
    ann3m: Math.round(ann3m * 10000) / 10000,
    trendYoy3m: Math.round(trendYoy3m * 10000) / 10000,
  };
}

// ═══════════════════════════════════════════════════════════════
// DETERMINE REGIME
// ═══════════════════════════════════════════════════════════════

function determineRegime(coreMetrics: CpiMetrics): CpiRegime {
  const { yoy, ann3m, trendYoy3m } = coreMetrics;
  
  // COOLING: trendYoy3m < -0.2% AND ann3m < yoy
  if (trendYoy3m < CPI_CONFIG.COOLING_TREND_THRESHOLD && ann3m < yoy) {
    return 'COOLING';
  }
  
  // REHEATING: trendYoy3m > +0.2% OR ann3m > yoy + 1%
  if (trendYoy3m > CPI_CONFIG.REHEATING_TREND_THRESHOLD || 
      ann3m > yoy + CPI_CONFIG.REHEATING_ANN3M_MARGIN) {
    return 'REHEATING';
  }
  
  return 'STABLE';
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE PRESSURE SCORE
// ═══════════════════════════════════════════════════════════════

function computePressure(coreYoy: number): number {
  // pressure = clamp((coreYoy - 2%) / 3%, -1, +1)
  const raw = (coreYoy - CPI_CONFIG.TARGET_INFLATION) / CPI_CONFIG.PRESSURE_DIVISOR;
  return Math.max(-1, Math.min(1, raw));
}

// ═══════════════════════════════════════════════════════════════
// GET CPI CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function getCpiContext(asOf?: Date): Promise<CpiContext> {
  const targetDate = asOf || new Date();
  
  // Compute metrics for both series
  const [headlineMetrics, coreMetrics] = await Promise.all([
    computeSeriesMetrics(CPI_SERIES.HEADLINE, targetDate),
    computeSeriesMetrics(CPI_SERIES.CORE, targetDate),
  ]);
  
  if (!headlineMetrics || !coreMetrics) {
    throw new Error('Insufficient CPI data for context computation');
  }
  
  // Determine regime based on core
  const regime = determineRegime(coreMetrics);
  
  // Compute pressure based on core YoY
  const pressure = computePressure(coreMetrics.yoy);
  
  // Get data point counts
  const [headlineCount, coreCount] = await Promise.all([
    CpiPointModel.countDocuments({ seriesId: CPI_SERIES.HEADLINE }),
    CpiPointModel.countDocuments({ seriesId: CPI_SERIES.CORE }),
  ]);
  
  const context: CpiContext = {
    headline: headlineMetrics,
    core: coreMetrics,
    regime,
    pressure: Math.round(pressure * 1000) / 1000,
    computedAt: new Date().toISOString(),
    dataPoints: {
      headline: headlineCount,
      core: coreCount,
    },
  };
  
  // Cache the computed context
  await CpiCacheModel.updateOne(
    { asOfDate: new Date(headlineMetrics.latestDate) },
    {
      $set: {
        headline: headlineMetrics,
        core: coreMetrics,
        regime,
        pressure,
      },
    },
    { upsert: true }
  );
  
  return context;
}

// ═══════════════════════════════════════════════════════════════
// GET CPI HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getCpiHistory(months: number = 120, series: 'headline' | 'core' = 'core'): Promise<Array<{
  date: string;
  value: number;
  yoy?: number;
}>> {
  const seriesId = series === 'headline' ? CPI_SERIES.HEADLINE : CPI_SERIES.CORE;
  
  const points = await CpiPointModel
    .find({ seriesId })
    .sort({ date: -1 })
    .limit(months + 12) // Extra for YoY calculation
    .lean();
  
  if (points.length === 0) {
    return [];
  }
  
  // Calculate YoY for each point
  const result: Array<{ date: string; value: number; yoy?: number }> = [];
  
  for (let i = 0; i < Math.min(months, points.length - 12); i++) {
    const current = points[i];
    const prev12m = points[i + 12];
    
    let yoy: number | undefined;
    if (prev12m) {
      yoy = Math.round(((current.value / prev12m.value) - 1) * 10000) / 10000;
    }
    
    result.push({
      date: current.date.toISOString().split('T')[0],
      value: current.value,
      yoy,
    });
  }
  
  return result.reverse(); // Return chronological order
}
