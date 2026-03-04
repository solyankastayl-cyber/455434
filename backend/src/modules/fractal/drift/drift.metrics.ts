/**
 * BLOCK 78.1 — Drift Metrics Computation
 * 
 * Computes comparison metrics from outcome data.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SimpleStats {
  n: number;
  hitRate: number;          // 0..1
  expectancy: number;       // decimal (e.g., 0.012)
  sharpe: number;
  calibration: number;      // decimal diff (expected - realized)
  maxDD: number;            // max drawdown decimal
  avgDivergence: number;    // average divergence score
}

export interface DeltaMetrics {
  hitRatePP: number;        // percentage points
  expectancy: number;       // absolute
  sharpe: number;           // absolute
  calibrationPP: number;    // percentage points
  maxDDPP?: number;         // percentage points
}

// ═══════════════════════════════════════════════════════════════
// STATS COMPUTATION
// ═══════════════════════════════════════════════════════════════

export function computeSimpleStats(outcomes: any[]): SimpleStats {
  const n = outcomes.length;
  
  if (!n) {
    return {
      n: 0,
      hitRate: 0,
      expectancy: 0,
      sharpe: 0,
      calibration: 0,
      maxDD: 0,
      avgDivergence: 0,
    };
  }
  
  // Hit rate
  const hits = outcomes.filter(o => o.hit === true).length;
  const hitRate = hits / n;
  
  // Realized returns
  const realized = outcomes.map(o => Number(o.realizedReturnPct ?? 0) / 100);
  
  // Expected returns (from predicted p50 or expectedReturn)
  const expected = outcomes.map(o => {
    if (o.predicted?.p50 !== undefined) return Number(o.predicted.p50);
    if (o.expectedReturn !== undefined) return Number(o.expectedReturn);
    return 0;
  });
  
  // Expectancy (mean realized return)
  const mean = realized.reduce((a, b) => a + b, 0) / n;
  
  // Sharpe ratio (simplified: mean / std)
  const variance = realized.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 1e-9 ? mean / std : 0;
  
  // Calibration (expected - realized gap)
  const calibration = expected.reduce((a, b, i) => a + (b - realized[i]), 0) / n;
  
  // Max Drawdown (simplified)
  let cumReturn = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of realized) {
    cumReturn += r;
    if (cumReturn > peak) peak = cumReturn;
    const dd = peak - cumReturn;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Average divergence score
  const divScores = outcomes
    .map(o => o.predicted?.divergenceScore ?? o.meta?.divergenceScore)
    .filter(d => d !== undefined);
  const avgDivergence = divScores.length > 0
    ? divScores.reduce((a, b) => a + b, 0) / divScores.length
    : 50;
  
  return {
    n,
    hitRate,
    expectancy: mean,
    sharpe,
    calibration,
    maxDD,
    avgDivergence,
  };
}

// ═══════════════════════════════════════════════════════════════
// DELTA COMPUTATION
// ═══════════════════════════════════════════════════════════════

export function computeDeltas(statsA: SimpleStats, statsB: SimpleStats): DeltaMetrics {
  return {
    hitRatePP: (statsA.hitRate - statsB.hitRate) * 100,
    expectancy: statsA.expectancy - statsB.expectancy,
    sharpe: statsA.sharpe - statsB.sharpe,
    calibrationPP: (statsA.calibration - statsB.calibration) * 100,
    maxDDPP: (statsA.maxDD - statsB.maxDD) * 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════

export function groupOutcomesByField(outcomes: any[], field: string): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  
  for (const o of outcomes) {
    let value: string;
    
    // Handle nested fields
    if (field === 'volRegime' || field === 'phaseType' || field === 'divergenceGrade') {
      value = String(o.meta?.[field] ?? o.predicted?.[field] ?? 'UNKNOWN');
    } else if (field === 'tier') {
      // Map focus to tier
      const focus = o.focus;
      if (['180d', '365d'].includes(focus)) value = 'STRUCTURE';
      else if (['30d', '90d'].includes(focus)) value = 'TACTICAL';
      else value = 'TIMING';
    } else {
      value = String(o[field] ?? 'UNKNOWN');
    }
    
    if (!groups[value]) groups[value] = [];
    groups[value].push(o);
  }
  
  return groups;
}
