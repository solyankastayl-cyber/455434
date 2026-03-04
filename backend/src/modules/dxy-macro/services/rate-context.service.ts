/**
 * RATE CONTEXT SERVICE — D6 v1
 * 
 * Computes Federal Funds Rate context for macro adjustment.
 * 
 * ISOLATION: Does NOT modify DXY fractal core.
 * Only reads historical Fed Funds data.
 */

import { FedFundsModel } from '../storage/fed-funds.model.js';
import { RateContext, MACRO_CONFIG } from '../contracts/dxy-macro.contract.js';

// ═══════════════════════════════════════════════════════════════
// GET RATE CONTEXT
// ═══════════════════════════════════════════════════════════════

export async function getRateContext(asOf?: Date): Promise<RateContext> {
  const targetDate = asOf || new Date();
  
  // Get all data points up to asOf, sorted ascending
  const series = await FedFundsModel
    .find({ date: { $lte: targetDate } })
    .sort({ date: 1 })
    .lean();
  
  if (series.length < MACRO_CONFIG.MIN_DATA_POINTS) {
    throw new Error(`Not enough FEDFUNDS data: have ${series.length}, need ${MACRO_CONFIG.MIN_DATA_POINTS}`);
  }
  
  const n = series.length;
  
  // Current rate (latest)
  const current = series[n - 1];
  
  // 3 months ago (index n-4 for monthly data)
  const prev3m = series[n - 4] || series[0];
  
  // 12 months ago (index n-13 for monthly data)
  const prev12m = series[n - 13] || series[0];
  
  // Calculate deltas
  const delta3m = current.value - prev3m.value;
  const delta12m = current.value - prev12m.value;
  
  // Determine regime based on 12-month delta
  let regime: 'tightening' | 'easing' | 'neutral';
  if (delta12m > MACRO_CONFIG.TIGHTENING_THRESHOLD) {
    regime = 'tightening';
  } else if (delta12m < MACRO_CONFIG.EASING_THRESHOLD) {
    regime = 'easing';
  } else {
    regime = 'neutral';
  }
  
  // Determine momentum based on 3-month delta
  let momentum: 'up' | 'down' | 'flat';
  if (delta3m > 0.1) {
    momentum = 'up';
  } else if (delta3m < -0.1) {
    momentum = 'down';
  } else {
    momentum = 'flat';
  }
  
  return {
    currentRate: Math.round(current.value * 100) / 100,
    delta3m: Math.round(delta3m * 100) / 100,
    delta12m: Math.round(delta12m * 100) / 100,
    regime,
    momentum,
    asOf: current.date.toISOString().split('T')[0],
    dataPoints: n,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET RATE HISTORY
// ═══════════════════════════════════════════════════════════════

export async function getRateHistory(months: number = 24): Promise<Array<{
  date: string;
  value: number;
}>> {
  const series = await FedFundsModel
    .find()
    .sort({ date: -1 })
    .limit(months)
    .lean();
  
  return series
    .map(dp => ({
      date: dp.date.toISOString().split('T')[0],
      value: dp.value,
    }))
    .reverse();
}
