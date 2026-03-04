/**
 * SEED METRICS SERVICE
 * 
 * Calculates per-horizon metrics from seed snapshots.
 * This allows detailed analysis of model performance by horizon.
 */

import mongoose from 'mongoose';

export interface HorizonMetrics {
  horizon: string;
  sampleCount: number;
  hitRate: number;
  avgError: number;
  avgAbsError: number;
  maxError: number;
  minError: number;
  stdError: number;
  positiveHits: number;
  negativeHits: number;
}

export interface SeedMetricsSummary {
  scope: string;
  totalSnapshots: number;
  byHorizon: HorizonMetrics[];
  overall: {
    avgHitRate: number;
    avgAbsError: number;
    trend: 'improving' | 'stable' | 'worsening' | 'unknown';
  };
}

/**
 * Get per-horizon metrics from seed snapshots
 */
export async function getSeedMetrics(scope: string): Promise<SeedMetricsSummary> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  // Get all seed snapshots for scope
  const snapshots = await db.collection('fractal_signal_snapshots')
    .find({
      symbol: scope,
      origin: 'seed_backtest',
      resolved: true
    })
    .toArray();
  
  if (snapshots.length === 0) {
    return {
      scope,
      totalSnapshots: 0,
      byHorizon: [],
      overall: {
        avgHitRate: 0,
        avgAbsError: 0,
        trend: 'unknown'
      }
    };
  }
  
  // Collect outcomes by horizon
  const horizonData: Record<string, Array<{
    hit: boolean;
    error: number;
    expectedReturn: number;
    realizedReturn: number;
    resolvedAt: Date;
  }>> = {};
  
  for (const snapshot of snapshots) {
    const outcomes = snapshot.outcomes || {};
    const expectedReturn = snapshot.expectedReturn || 0;
    
    for (const [horizon, outcome] of Object.entries(outcomes)) {
      if (!outcome) continue;
      
      const o = outcome as any;
      const realizedReturn = o.realizedReturn || 0;
      const error = realizedReturn - expectedReturn;
      
      if (!horizonData[horizon]) {
        horizonData[horizon] = [];
      }
      
      horizonData[horizon].push({
        hit: o.hit,
        error,
        expectedReturn,
        realizedReturn,
        resolvedAt: new Date(o.resolvedAt)
      });
    }
  }
  
  // Calculate per-horizon metrics
  const byHorizon: HorizonMetrics[] = [];
  
  for (const [horizon, data] of Object.entries(horizonData)) {
    if (data.length === 0) continue;
    
    const errors = data.map(d => d.error);
    const hits = data.filter(d => d.hit).length;
    const positiveHits = data.filter(d => d.hit && d.realizedReturn > 0).length;
    const negativeHits = data.filter(d => d.hit && d.realizedReturn < 0).length;
    
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const absErrors = errors.map(Math.abs);
    const avgAbsError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
    const maxError = Math.max(...absErrors);
    const minError = Math.min(...absErrors);
    
    // Standard deviation
    const variance = errors.reduce((sum, e) => sum + Math.pow(e - avgError, 2), 0) / errors.length;
    const stdError = Math.sqrt(variance);
    
    byHorizon.push({
      horizon,
      sampleCount: data.length,
      hitRate: Math.round((hits / data.length) * 10000) / 100, // percentage
      avgError: Math.round(avgError * 10000) / 10000,
      avgAbsError: Math.round(avgAbsError * 10000) / 10000,
      maxError: Math.round(maxError * 10000) / 10000,
      minError: Math.round(minError * 10000) / 10000,
      stdError: Math.round(stdError * 10000) / 10000,
      positiveHits,
      negativeHits
    });
  }
  
  // Sort by horizon (7d, 14d, 30d, 90d)
  const horizonOrder = ['7d', '14d', '30d', '90d', '180d', '365d'];
  byHorizon.sort((a, b) => {
    const aIdx = horizonOrder.indexOf(a.horizon);
    const bIdx = horizonOrder.indexOf(b.horizon);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
  
  // Overall metrics
  const allHitRates = byHorizon.map(h => h.hitRate);
  const allAbsErrors = byHorizon.map(h => h.avgAbsError);
  const avgHitRate = allHitRates.length > 0 
    ? Math.round((allHitRates.reduce((a, b) => a + b, 0) / allHitRates.length) * 100) / 100
    : 0;
  const avgAbsError = allAbsErrors.length > 0
    ? Math.round((allAbsErrors.reduce((a, b) => a + b, 0) / allAbsErrors.length) * 10000) / 10000
    : 0;
  
  // Determine trend (compare first half vs second half of errors chronologically)
  const allData = Object.values(horizonData).flat().sort(
    (a, b) => a.resolvedAt.getTime() - b.resolvedAt.getTime()
  );
  
  let trend: 'improving' | 'stable' | 'worsening' | 'unknown' = 'unknown';
  if (allData.length >= 20) {
    const half = Math.floor(allData.length / 2);
    const oldErrors = allData.slice(0, half).map(d => Math.abs(d.error));
    const newErrors = allData.slice(half).map(d => Math.abs(d.error));
    
    const oldAvg = oldErrors.reduce((a, b) => a + b, 0) / oldErrors.length;
    const newAvg = newErrors.reduce((a, b) => a + b, 0) / newErrors.length;
    
    if (newAvg < oldAvg * 0.9) trend = 'improving';
    else if (newAvg > oldAvg * 1.1) trend = 'worsening';
    else trend = 'stable';
  }
  
  return {
    scope,
    totalSnapshots: snapshots.length,
    byHorizon,
    overall: {
      avgHitRate,
      avgAbsError,
      trend
    }
  };
}

/**
 * Get error distribution histogram
 */
export async function getErrorDistribution(scope: string, bins: number = 20): Promise<{
  scope: string;
  histogram: Array<{ range: string; count: number; percentage: number }>;
  stats: { min: number; max: number; median: number; p10: number; p90: number };
}> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  // Get all seed errors
  const snapshots = await db.collection('fractal_signal_snapshots')
    .find({
      symbol: scope,
      origin: 'seed_backtest',
      resolved: true
    })
    .toArray();
  
  const errors: number[] = [];
  
  for (const snapshot of snapshots) {
    const outcomes = snapshot.outcomes || {};
    const expectedReturn = snapshot.expectedReturn || 0;
    
    for (const outcome of Object.values(outcomes)) {
      if (!outcome) continue;
      const o = outcome as any;
      const error = Math.abs((o.realizedReturn || 0) - expectedReturn);
      errors.push(error);
    }
  }
  
  if (errors.length === 0) {
    return {
      scope,
      histogram: [],
      stats: { min: 0, max: 0, median: 0, p10: 0, p90: 0 }
    };
  }
  
  // Sort for percentiles
  errors.sort((a, b) => a - b);
  
  const min = errors[0];
  const max = errors[errors.length - 1];
  const median = errors[Math.floor(errors.length / 2)];
  const p10 = errors[Math.floor(errors.length * 0.1)];
  const p90 = errors[Math.floor(errors.length * 0.9)];
  
  // Create histogram
  const binSize = (max - min) / bins;
  const histogram: Array<{ range: string; count: number; percentage: number }> = [];
  
  for (let i = 0; i < bins; i++) {
    const binStart = min + i * binSize;
    const binEnd = min + (i + 1) * binSize;
    const count = errors.filter(e => e >= binStart && (i === bins - 1 ? e <= binEnd : e < binEnd)).length;
    
    histogram.push({
      range: `${(binStart * 100).toFixed(1)}% - ${(binEnd * 100).toFixed(1)}%`,
      count,
      percentage: Math.round((count / errors.length) * 10000) / 100
    });
  }
  
  return {
    scope,
    histogram,
    stats: {
      min: Math.round(min * 10000) / 10000,
      max: Math.round(max * 10000) / 10000,
      median: Math.round(median * 10000) / 10000,
      p10: Math.round(p10 * 10000) / 10000,
      p90: Math.round(p90 * 10000) / 10000
    }
  };
}
