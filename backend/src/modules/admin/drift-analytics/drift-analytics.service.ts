/**
 * P6 DRIFT ANALYTICS SERVICE
 * 
 * Provides:
 * - P6-A: Per-horizon metrics breakdown
 * - P6-B: Rolling trend analysis
 * - P6-C: Regime segmentation
 * - P6-D: Composite vs parents comparison
 * - P6-E: Weight attribution
 */

import mongoose from 'mongoose';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type AdminScope = 'BTC' | 'SPX' | 'DXY' | 'CROSS_ASSET';
export type RegimeType = 'BULL_LOW_VOL' | 'BULL_HIGH_VOL' | 'BEAR_LOW_VOL' | 'BEAR_HIGH_VOL' | 'UNKNOWN';
export type TrendDirection = 'improving' | 'stable' | 'worsening' | 'unknown';

export interface HorizonMetrics {
  horizon: string;
  sampleCount: number;
  hitRate: number;
  avgError: number;
  avgAbsError: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
  trend: TrendDirection;
}

export interface RollingPoint {
  t: string;           // ISO date
  windowEnd: string;   // ISO date
  hitRate: number;
  avgAbsError: number;
  avgError: number;
  sampleCount: number;
}

export interface RegimeMetrics {
  regime: RegimeType;
  sampleCount: number;
  hitRate: number;
  avgAbsError: number;
  avgError: number;
  p90: number;
}

export interface ScopeMetrics {
  scope: AdminScope;
  hitRate: number;
  avgAbsError: number;
  sampleCount: number;
}

export interface CompositeComparison {
  composite: ScopeMetrics;
  parents: ScopeMetrics[];
  improvement: {
    hitRateDelta: number;      // composite - best parent
    avgAbsErrorDelta: number;  // composite - weighted avg parent
    verdict: 'BETTER' | 'WORSE' | 'SIMILAR';
  };
}

// ═══════════════════════════════════════════════════════════════
// P6-A: BY-HORIZON METRICS
// ═══════════════════════════════════════════════════════════════

export async function getByHorizon(
  scope: AdminScope,
  includeSeed: boolean = false
): Promise<{ ok: boolean; scope: AdminScope; dataMode: string; byHorizon: HorizonMetrics[] }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  // Build query
  const query: any = { symbol: scope, resolved: true };
  if (includeSeed) {
    // Include both live and seed
    query.$or = [{ origin: 'live' }, { origin: 'seed_backtest' }];
  } else {
    query.origin = { $ne: 'seed_backtest' };
  }
  
  const snapshots = await db.collection('fractal_signal_snapshots')
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();
  
  if (snapshots.length === 0) {
    return {
      ok: true,
      scope,
      dataMode: includeSeed ? 'SEED' : 'LIVE',
      byHorizon: []
    };
  }
  
  // Collect outcomes by horizon
  const horizonData: Record<string, Array<{
    hit: boolean;
    error: number;
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
      
      if (!horizonData[horizon]) horizonData[horizon] = [];
      horizonData[horizon].push({
        hit: o.hit === true,
        error,
        resolvedAt: new Date(o.resolvedAt || snapshot.createdAt)
      });
    }
  }
  
  // Calculate per-horizon metrics with percentiles
  const byHorizon: HorizonMetrics[] = [];
  const horizonOrder = ['7d', '14d', '30d', '90d', '180d', '365d'];
  
  for (const [horizon, data] of Object.entries(horizonData)) {
    if (data.length === 0) continue;
    
    const errors = data.map(d => d.error);
    const absErrors = errors.map(Math.abs).sort((a, b) => a - b);
    const hits = data.filter(d => d.hit).length;
    
    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    const avgAbsError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
    
    // Percentiles
    const p50 = absErrors[Math.floor(absErrors.length * 0.5)] || 0;
    const p90 = absErrors[Math.floor(absErrors.length * 0.9)] || 0;
    const p95 = absErrors[Math.floor(absErrors.length * 0.95)] || 0;
    const max = absErrors[absErrors.length - 1] || 0;
    
    // Trend: compare first half vs second half
    let trend: TrendDirection = 'unknown';
    if (data.length >= 10) {
      const sorted = [...data].sort((a, b) => a.resolvedAt.getTime() - b.resolvedAt.getTime());
      const half = Math.floor(sorted.length / 2);
      const oldAvg = sorted.slice(0, half).map(d => Math.abs(d.error)).reduce((a, b) => a + b, 0) / half;
      const newAvg = sorted.slice(half).map(d => Math.abs(d.error)).reduce((a, b) => a + b, 0) / (sorted.length - half);
      
      if (newAvg < oldAvg * 0.9) trend = 'improving';
      else if (newAvg > oldAvg * 1.1) trend = 'worsening';
      else trend = 'stable';
    }
    
    byHorizon.push({
      horizon,
      sampleCount: data.length,
      hitRate: round((hits / data.length) * 100, 2),
      avgError: round(avgError * 100, 2),
      avgAbsError: round(avgAbsError * 100, 2),
      p50: round(p50 * 100, 2),
      p90: round(p90 * 100, 2),
      p95: round(p95 * 100, 2),
      max: round(max * 100, 2),
      trend
    });
  }
  
  // Sort by horizon order
  byHorizon.sort((a, b) => {
    const aIdx = horizonOrder.indexOf(a.horizon);
    const bIdx = horizonOrder.indexOf(b.horizon);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });
  
  return {
    ok: true,
    scope,
    dataMode: includeSeed ? 'SEED' : (snapshots.length < 30 ? 'BOOTSTRAP' : 'LIVE'),
    byHorizon
  };
}

// ═══════════════════════════════════════════════════════════════
// P6-B: ROLLING TREND
// ═══════════════════════════════════════════════════════════════

export async function getRolling(
  scope: AdminScope,
  horizon: string = '30d',
  windowSize: number = 50,
  includeSeed: boolean = false
): Promise<{ ok: boolean; scope: AdminScope; horizon: string; windowSize: number; points: RollingPoint[] }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  const query: any = { symbol: scope, resolved: true };
  if (includeSeed) {
    query.$or = [{ origin: 'live' }, { origin: 'seed_backtest' }];
  } else {
    query.origin = { $ne: 'seed_backtest' };
  }
  
  const snapshots = await db.collection('fractal_signal_snapshots')
    .find(query)
    .sort({ createdAt: 1 })  // Oldest first for rolling
    .toArray();
  
  // Extract horizon outcomes with dates
  const outcomes: Array<{ date: Date; hit: boolean; error: number }> = [];
  
  for (const snapshot of snapshots) {
    const outcome = snapshot.outcomes?.[horizon];
    if (!outcome) continue;
    
    const o = outcome as any;
    const expectedReturn = snapshot.expectedReturn || 0;
    const realizedReturn = o.realizedReturn || 0;
    
    outcomes.push({
      date: new Date(o.resolvedAt || snapshot.createdAt),
      hit: o.hit === true,
      error: realizedReturn - expectedReturn
    });
  }
  
  // Sort by date
  outcomes.sort((a, b) => a.date.getTime() - b.date.getTime());
  
  // Calculate rolling windows
  const points: RollingPoint[] = [];
  
  for (let i = windowSize - 1; i < outcomes.length; i++) {
    const windowData = outcomes.slice(i - windowSize + 1, i + 1);
    const hits = windowData.filter(d => d.hit).length;
    const errors = windowData.map(d => d.error);
    const absErrors = errors.map(Math.abs);
    
    points.push({
      t: windowData[0].date.toISOString().slice(0, 10),
      windowEnd: windowData[windowData.length - 1].date.toISOString().slice(0, 10),
      hitRate: round((hits / windowData.length) * 100, 2),
      avgAbsError: round((absErrors.reduce((a, b) => a + b, 0) / absErrors.length) * 100, 2),
      avgError: round((errors.reduce((a, b) => a + b, 0) / errors.length) * 100, 2),
      sampleCount: windowData.length
    });
  }
  
  return {
    ok: true,
    scope,
    horizon,
    windowSize,
    points
  };
}

// ═══════════════════════════════════════════════════════════════
// P6-C: REGIME SEGMENTATION
// ═══════════════════════════════════════════════════════════════

export async function getByRegime(
  scope: AdminScope,
  horizon: string = '30d',
  includeSeed: boolean = false
): Promise<{ ok: boolean; scope: AdminScope; horizon: string; byRegime: RegimeMetrics[] }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  const query: any = { symbol: scope, resolved: true };
  if (includeSeed) {
    query.$or = [{ origin: 'live' }, { origin: 'seed_backtest' }];
  } else {
    query.origin = { $ne: 'seed_backtest' };
  }
  
  const snapshots = await db.collection('fractal_signal_snapshots')
    .find(query)
    .toArray();
  
  // Group by regime
  const regimeData: Record<RegimeType, Array<{ hit: boolean; error: number }>> = {
    BULL_LOW_VOL: [],
    BULL_HIGH_VOL: [],
    BEAR_LOW_VOL: [],
    BEAR_HIGH_VOL: [],
    UNKNOWN: []
  };
  
  for (const snapshot of snapshots) {
    const outcome = snapshot.outcomes?.[horizon];
    if (!outcome) continue;
    
    const o = outcome as any;
    const expectedReturn = snapshot.expectedReturn || 0;
    const realizedReturn = o.realizedReturn || 0;
    
    // Determine regime from snapshot context
    const regime = classifyRegime(snapshot);
    
    regimeData[regime].push({
      hit: o.hit === true,
      error: realizedReturn - expectedReturn
    });
  }
  
  // Calculate metrics per regime
  const byRegime: RegimeMetrics[] = [];
  
  for (const [regime, data] of Object.entries(regimeData)) {
    if (data.length === 0) continue;
    
    const hits = data.filter(d => d.hit).length;
    const errors = data.map(d => d.error);
    const absErrors = errors.map(Math.abs).sort((a, b) => a - b);
    
    byRegime.push({
      regime: regime as RegimeType,
      sampleCount: data.length,
      hitRate: round((hits / data.length) * 100, 2),
      avgAbsError: round((absErrors.reduce((a, b) => a + b, 0) / absErrors.length) * 100, 2),
      avgError: round((errors.reduce((a, b) => a + b, 0) / errors.length) * 100, 2),
      p90: round(absErrors[Math.floor(absErrors.length * 0.9)] * 100, 2) || 0
    });
  }
  
  // Sort by sample count
  byRegime.sort((a, b) => b.sampleCount - a.sampleCount);
  
  return {
    ok: true,
    scope,
    horizon,
    byRegime
  };
}

// ═══════════════════════════════════════════════════════════════
// P6-D: COMPOSITE COMPARISON
// ═══════════════════════════════════════════════════════════════

export async function getCompositeComparison(
  includeSeed: boolean = false
): Promise<{ ok: boolean; comparison: CompositeComparison }> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB not connected');
  
  const scopes: AdminScope[] = ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'];
  const scopeMetrics: ScopeMetrics[] = [];
  
  for (const scope of scopes) {
    const query: any = { symbol: scope, resolved: true };
    if (includeSeed) {
      query.$or = [{ origin: 'live' }, { origin: 'seed_backtest' }];
    } else {
      query.origin = { $ne: 'seed_backtest' };
    }
    
    const snapshots = await db.collection('fractal_signal_snapshots')
      .find(query)
      .toArray();
    
    let totalHits = 0;
    let totalSamples = 0;
    let totalAbsError = 0;
    
    for (const snapshot of snapshots) {
      const outcomes = snapshot.outcomes || {};
      const expectedReturn = snapshot.expectedReturn || 0;
      
      for (const outcome of Object.values(outcomes)) {
        if (!outcome) continue;
        const o = outcome as any;
        totalSamples++;
        if (o.hit) totalHits++;
        totalAbsError += Math.abs((o.realizedReturn || 0) - expectedReturn);
      }
    }
    
    scopeMetrics.push({
      scope,
      hitRate: totalSamples > 0 ? round((totalHits / totalSamples) * 100, 2) : 0,
      avgAbsError: totalSamples > 0 ? round((totalAbsError / totalSamples) * 100, 2) : 0,
      sampleCount: totalSamples
    });
  }
  
  const composite = scopeMetrics.find(m => m.scope === 'CROSS_ASSET') || {
    scope: 'CROSS_ASSET' as AdminScope,
    hitRate: 0,
    avgAbsError: 0,
    sampleCount: 0
  };
  
  const parents = scopeMetrics.filter(m => m.scope !== 'CROSS_ASSET');
  
  // Calculate improvement
  const bestParentHitRate = Math.max(...parents.map(p => p.hitRate));
  const weightedAvgError = parents.reduce((sum, p) => sum + p.avgAbsError * p.sampleCount, 0) /
    Math.max(1, parents.reduce((sum, p) => sum + p.sampleCount, 0));
  
  const hitRateDelta = composite.hitRate - bestParentHitRate;
  const avgAbsErrorDelta = composite.avgAbsError - weightedAvgError;
  
  let verdict: 'BETTER' | 'WORSE' | 'SIMILAR' = 'SIMILAR';
  if (hitRateDelta > 2 && avgAbsErrorDelta < 0) verdict = 'BETTER';
  else if (hitRateDelta < -2 || avgAbsErrorDelta > 2) verdict = 'WORSE';
  
  return {
    ok: true,
    comparison: {
      composite,
      parents,
      improvement: {
        hitRateDelta: round(hitRateDelta, 2),
        avgAbsErrorDelta: round(avgAbsErrorDelta, 2),
        verdict
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// P6-E: WEIGHT ATTRIBUTION
// ═══════════════════════════════════════════════════════════════

export async function getWeightAttribution(
  includeSeed: boolean = false
): Promise<{
  ok: boolean;
  weights: Array<{ scope: AdminScope; weight: number; contribution: number }>;
  sanity: { sumToOne: boolean; hasNaN: boolean; hasInf: boolean };
  lineage: { parentVersions: Record<string, string> };
}> {
  // Default weights (could be stored in DB)
  const weights: Array<{ scope: AdminScope; weight: number; contribution: number }> = [
    { scope: 'BTC', weight: 0.50, contribution: 0 },
    { scope: 'SPX', weight: 0.30, contribution: 0 },
    { scope: 'DXY', weight: 0.20, contribution: 0 }
  ];
  
  // Calculate contributions based on performance
  const comparison = await getCompositeComparison(includeSeed);
  
  for (const w of weights) {
    const parent = comparison.comparison.parents.find(p => p.scope === w.scope);
    if (parent) {
      w.contribution = round(w.weight * parent.hitRate, 2);
    }
  }
  
  // Sanity checks
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const hasNaN = weights.some(w => isNaN(w.weight) || isNaN(w.contribution));
  const hasInf = weights.some(w => !isFinite(w.weight) || !isFinite(w.contribution));
  
  return {
    ok: true,
    weights,
    sanity: {
      sumToOne: Math.abs(totalWeight - 1.0) < 0.001,
      hasNaN,
      hasInf
    },
    lineage: {
      parentVersions: {
        BTC: 'v2.0-fractal',
        SPX: 'v2.0-fractal',
        DXY: 'v2.0-macro'
      }
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

function classifyRegime(snapshot: any): RegimeType {
  // Use snapshot.phaseType and volatility info if available
  const phase = snapshot.phaseType || snapshot.context?.phase || '';
  const volRegime = snapshot.volRegime || snapshot.context?.volatility || '';
  
  const isBull = /bull|growth|expansion|up/i.test(phase);
  const isBear = /bear|contraction|decline|down/i.test(phase);
  const isHighVol = /high|elevated|extreme/i.test(volRegime);
  const isLowVol = /low|normal|calm/i.test(volRegime);
  
  if (isBull && isLowVol) return 'BULL_LOW_VOL';
  if (isBull && isHighVol) return 'BULL_HIGH_VOL';
  if (isBear && isLowVol) return 'BEAR_LOW_VOL';
  if (isBear && isHighVol) return 'BEAR_HIGH_VOL';
  
  // Fallback: use expected return direction
  const expectedReturn = snapshot.expectedReturn || 0;
  if (expectedReturn > 0) return isHighVol ? 'BULL_HIGH_VOL' : 'BULL_LOW_VOL';
  if (expectedReturn < 0) return isHighVol ? 'BEAR_HIGH_VOL' : 'BEAR_LOW_VOL';
  
  return 'UNKNOWN';
}
