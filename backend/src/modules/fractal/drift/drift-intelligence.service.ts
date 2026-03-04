/**
 * BLOCK 81 — Drift Intelligence Service
 * 
 * Institutional-grade LIVE vs V2014/V2020 drift comparison.
 * Computes deltas, severity, confidence, and breakdowns.
 */

import { PredictionOutcomeModel } from '../memory/outcome/prediction-outcome.model.js';
import type {
  DriftIntelSeverity,
  DriftIntelConfidence,
  DriftIntelMetrics,
  DriftIntelDelta,
  DriftIntelVerdict,
  CohortMetricsBlock,
  CohortId,
  TierBreakdown,
  RegimeBreakdown,
  DivergenceBreakdown,
  DriftIntelligenceResponse,
} from './drift-intelligence.types.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (Institutional Grade)
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  // Confidence based on LIVE samples
  CONFIDENCE: {
    LOW: 30,
    MED: 90,
  },
  
  // WATCH thresholds
  WATCH: {
    hitRate_pp: 2,
    sharpe: 0.2,
    calibration_pp: 2,
  },
  
  // WARN thresholds
  WARN: {
    hitRate_pp: 5,
    sharpe: 0.5,
    calibration_pp: 5,
  },
  
  // CRITICAL thresholds
  CRITICAL: {
    hitRate_pp: 8,
    sharpe: 0.8,
    calibration_pp: 8,
    maxDD_pp: 3, // MaxDD regression
  },
};

// ═══════════════════════════════════════════════════════════════
// METRICS COMPUTATION
// ═══════════════════════════════════════════════════════════════

function computeMetrics(outcomes: any[]): DriftIntelMetrics {
  const n = outcomes.length;
  
  if (!n) {
    return {
      hitRate: 0,
      expectancy: 0,
      sharpe: 0,
      maxDD: 0,
      profitFactor: 0,
      calibrationError: 0,
      samples: 0,
    };
  }
  
  // Hit rate
  const hits = outcomes.filter(o => o.hit === true).length;
  const hitRate = hits / n;
  
  // Realized returns
  const realized = outcomes.map(o => Number(o.realizedReturnPct ?? 0) / 100);
  
  // Expected returns
  const expected = outcomes.map(o => {
    if (o.predicted?.p50 !== undefined) return Number(o.predicted.p50);
    if (o.expectedReturn !== undefined) return Number(o.expectedReturn);
    return 0;
  });
  
  // Expectancy (mean realized return)
  const mean = realized.reduce((a, b) => a + b, 0) / n;
  
  // Sharpe ratio (mean / std)
  const variance = realized.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const std = Math.sqrt(variance);
  const sharpe = std > 1e-9 ? mean / std : 0;
  
  // Calibration error (expected - realized gap)
  const calibrationError = expected.reduce((a, b, i) => a + (b - realized[i]), 0) / n;
  
  // Max Drawdown
  let cumReturn = 0;
  let peak = 0;
  let maxDD = 0;
  for (const r of realized) {
    cumReturn += r;
    if (cumReturn > peak) peak = cumReturn;
    const dd = peak - cumReturn;
    if (dd > maxDD) maxDD = dd;
  }
  
  // Profit Factor (sum of wins / sum of losses)
  const wins = realized.filter(r => r > 0);
  const losses = realized.filter(r => r < 0);
  const sumWins = wins.reduce((a, b) => a + b, 0);
  const sumLosses = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = sumLosses > 0 ? sumWins / sumLosses : sumWins > 0 ? 100 : 0;
  
  return {
    hitRate,
    expectancy: mean,
    sharpe,
    maxDD,
    profitFactor,
    calibrationError,
    samples: n,
  };
}

function computeDelta(live: DriftIntelMetrics, base: DriftIntelMetrics): DriftIntelDelta | null {
  if (!live.samples || !base.samples) return null;
  
  return {
    dHitRate_pp: (live.hitRate - base.hitRate) * 100,
    dSharpe: live.sharpe - base.sharpe,
    dCalibration_pp: (live.calibrationError - base.calibrationError) * 100,
    dMaxDD_pp: (live.maxDD - base.maxDD) * 100,
    dExpectancy: live.expectancy - base.expectancy,
    dProfitFactor: live.profitFactor - base.profitFactor,
  };
}

// ═══════════════════════════════════════════════════════════════
// SEVERITY & CONFIDENCE LOGIC
// ═══════════════════════════════════════════════════════════════

function computeConfidence(liveSamples: number): DriftIntelConfidence {
  if (liveSamples < THRESHOLDS.CONFIDENCE.LOW) return 'LOW';
  if (liveSamples < THRESHOLDS.CONFIDENCE.MED) return 'MED';
  return 'HIGH';
}

function computeSeverity(
  delta: DriftIntelDelta | null,
  confidence: DriftIntelConfidence
): { severity: DriftIntelSeverity; reasons: string[] } {
  const reasons: string[] = [];
  
  if (!delta) {
    reasons.push('NO_BASELINE_DATA');
    return { severity: 'WATCH', reasons };
  }
  
  const absHit = Math.abs(delta.dHitRate_pp);
  const absSharpe = Math.abs(delta.dSharpe);
  const absCalib = Math.abs(delta.dCalibration_pp);
  const absMaxDD = Math.abs(delta.dMaxDD_pp);
  
  let severity: DriftIntelSeverity = 'OK';
  
  // CRITICAL check
  if (
    absHit >= THRESHOLDS.CRITICAL.hitRate_pp ||
    absSharpe >= THRESHOLDS.CRITICAL.sharpe ||
    absCalib >= THRESHOLDS.CRITICAL.calibration_pp ||
    delta.dMaxDD_pp >= THRESHOLDS.CRITICAL.maxDD_pp
  ) {
    severity = 'CRITICAL';
    if (absHit >= THRESHOLDS.CRITICAL.hitRate_pp) {
      reasons.push(`HIT_RATE_DRIFT_${delta.dHitRate_pp > 0 ? 'UP' : 'DOWN'}_${absHit.toFixed(1)}pp`);
    }
    if (absSharpe >= THRESHOLDS.CRITICAL.sharpe) {
      reasons.push(`SHARPE_${delta.dSharpe > 0 ? 'IMPROVEMENT' : 'COLLAPSE'}_${delta.dSharpe.toFixed(2)}`);
    }
    if (absCalib >= THRESHOLDS.CRITICAL.calibration_pp) {
      reasons.push(`CALIBRATION_DRIFT_${absCalib.toFixed(1)}pp`);
    }
    if (delta.dMaxDD_pp >= THRESHOLDS.CRITICAL.maxDD_pp) {
      reasons.push(`PROTECTION_REGRESSION_MAXDD_+${delta.dMaxDD_pp.toFixed(1)}pp`);
    }
  }
  // WARN check
  else if (
    absHit >= THRESHOLDS.WARN.hitRate_pp ||
    absSharpe >= THRESHOLDS.WARN.sharpe ||
    absCalib >= THRESHOLDS.WARN.calibration_pp
  ) {
    severity = 'WARN';
    if (absHit >= THRESHOLDS.WARN.hitRate_pp) {
      reasons.push(`MODERATE_HIT_RATE_DRIFT_${absHit.toFixed(1)}pp`);
    }
    if (absSharpe >= THRESHOLDS.WARN.sharpe) {
      reasons.push(`MODERATE_SHARPE_DRIFT_${delta.dSharpe.toFixed(2)}`);
    }
    if (absCalib >= THRESHOLDS.WARN.calibration_pp) {
      reasons.push(`MODERATE_CALIBRATION_DRIFT_${absCalib.toFixed(1)}pp`);
    }
  }
  // WATCH check
  else if (
    absHit >= THRESHOLDS.WATCH.hitRate_pp ||
    absSharpe >= THRESHOLDS.WATCH.sharpe ||
    absCalib >= THRESHOLDS.WATCH.calibration_pp
  ) {
    severity = 'WATCH';
    reasons.push('MINOR_DRIFT_DETECTED');
  }
  
  // Confidence gating: if LOW confidence, cap severity at WATCH
  if (confidence === 'LOW' && severity !== 'OK') {
    severity = 'WATCH';
    reasons.push('LIVE_SAMPLES_LT_30');
  }
  
  if (reasons.length === 0 && severity === 'OK') {
    reasons.push('ALL_METRICS_WITHIN_BOUNDS');
  }
  
  return { severity, reasons };
}

function getRecommendedActions(
  severity: DriftIntelSeverity,
  confidence: DriftIntelConfidence,
  insufficientLiveTruth: boolean
): string[] {
  const actions: string[] = [];
  
  if (insufficientLiveTruth) {
    actions.push('ACCUMULATE_LIVE_DATA');
  }
  
  switch (severity) {
    case 'CRITICAL':
      actions.push('FREEZE_POLICY_CHANGES');
      actions.push('INVESTIGATE_ROOT_CAUSE');
      actions.push('REVIEW_TIER_WEIGHTS');
      break;
    case 'WARN':
      actions.push('INVESTIGATE_DRIFT_SOURCE');
      actions.push('MONITOR_NEXT_7_DAYS');
      break;
    case 'WATCH':
      actions.push('CONTINUE_MONITORING');
      break;
    case 'OK':
      actions.push('NO_ACTION_REQUIRED');
      break;
  }
  
  return actions;
}

// ═══════════════════════════════════════════════════════════════
// BREAKDOWN HELPERS
// ═══════════════════════════════════════════════════════════════

function groupOutcomesByField(outcomes: any[], field: string): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  
  for (const o of outcomes) {
    let value: string;
    
    if (field === 'tier') {
      const focus = o.focus;
      if (['180d', '365d'].includes(focus)) value = 'STRUCTURE';
      else if (['30d', '90d'].includes(focus)) value = 'TACTICAL';
      else value = 'TIMING';
    } else if (field === 'regime') {
      value = String(o.meta?.volRegime ?? o.predicted?.volRegime ?? 'UNKNOWN');
    } else if (field === 'divergenceGrade') {
      value = String(o.meta?.divergenceGrade ?? o.predicted?.divergenceGrade ?? 'UNKNOWN');
    } else {
      value = String(o[field] ?? 'UNKNOWN');
    }
    
    if (!groups[value]) groups[value] = [];
    groups[value].push(o);
  }
  
  return groups;
}

function buildBreakdown(
  cohortData: Record<CohortId, any[]>,
  field: string
): any[] {
  const allValues = new Set<string>();
  
  for (const cohort of Object.values(cohortData)) {
    const grouped = groupOutcomesByField(cohort, field);
    for (const k of Object.keys(grouped)) {
      allValues.add(k);
    }
  }
  
  const result: any[] = [];
  
  for (const value of allValues) {
    const liveGroup = groupOutcomesByField(cohortData.LIVE || [], field)[value] || [];
    const v2020Group = groupOutcomesByField(cohortData.V2020 || [], field)[value] || [];
    const v2014Group = groupOutcomesByField(cohortData.V2014 || [], field)[value] || [];
    
    const liveMetrics = computeMetrics(liveGroup);
    const v2020Metrics = computeMetrics(v2020Group);
    const v2014Metrics = computeMetrics(v2014Group);
    
    const deltaLiveV2020 = computeDelta(liveMetrics, v2020Metrics);
    const deltaLiveV2014 = computeDelta(liveMetrics, v2014Metrics);
    
    // Compute worst severity for this breakdown entry
    const { severity: sevV2020 } = computeSeverity(deltaLiveV2020, 'HIGH');
    const { severity: sevV2014 } = computeSeverity(deltaLiveV2014, 'HIGH');
    const sevOrder: Record<DriftIntelSeverity, number> = { OK: 0, WATCH: 1, WARN: 2, CRITICAL: 3 };
    const worstSeverity = sevOrder[sevV2020] > sevOrder[sevV2014] ? sevV2020 : sevV2014;
    
    result.push({
      [field === 'tier' ? 'tier' : field === 'regime' ? 'regime' : 'grade']: value,
      live: liveMetrics,
      v2020: v2020Metrics,
      v2014: v2014Metrics,
      delta_LIVE_V2020: deltaLiveV2020,
      delta_LIVE_V2014: deltaLiveV2014,
      worstSeverity,
    });
  }
  
  // Sort by worst severity
  const sevOrder: Record<DriftIntelSeverity, number> = { OK: 0, WATCH: 1, WARN: 2, CRITICAL: 3 };
  result.sort((a, b) => sevOrder[b.worstSeverity] - sevOrder[a.worstSeverity]);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

class DriftIntelligenceService {
  
  /**
   * Query outcomes from MongoDB
   */
  private async queryOutcomes(params: {
    symbol: string;
    cohort: CohortId;
    windowDays?: number;
  }): Promise<any[]> {
    const query: any = {
      symbol: params.symbol,
    };
    
    if (params.cohort === 'LIVE') {
      query.source = 'LIVE';
    } else {
      query.source = 'BOOTSTRAP';
      query.cohort = params.cohort;
    }
    
    // Window filter for LIVE (no window filter for BOOTSTRAP - use all historical)
    if (params.cohort === 'LIVE' && params.windowDays && params.windowDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - params.windowDays);
      query.asofDate = { $gte: cutoff.toISOString().slice(0, 10) };
    }
    
    console.log(`[DriftIntelligence] Querying ${params.cohort}: ${JSON.stringify(query)}`);
    
    const outcomes = await PredictionOutcomeModel.find(query)
      .sort({ asofDate: -1 })
      .limit(50000)
      .lean();
    
    console.log(`[DriftIntelligence] Found ${outcomes.length} outcomes for ${params.cohort}`);
    
    return outcomes;
  }
  
  /**
   * Build coverage info from outcomes
   */
  private buildCoverage(outcomes: any[]): CohortMetricsBlock['coverage'] {
    const horizons = new Set<string>();
    const presets = new Set<string>();
    const regimes = new Set<string>();
    let minDate = '';
    let maxDate = '';
    
    for (const o of outcomes) {
      if (o.focus) horizons.add(o.focus);
      if (o.preset) presets.add(o.preset);
      if (o.meta?.volRegime) regimes.add(o.meta.volRegime);
      
      if (o.asofDate) {
        if (!minDate || o.asofDate < minDate) minDate = o.asofDate;
        if (!maxDate || o.asofDate > maxDate) maxDate = o.asofDate;
      }
    }
    
    return {
      horizons: Array.from(horizons),
      presets: Array.from(presets),
      regimes: Array.from(regimes),
      dateRange: {
        from: minDate,
        to: maxDate,
      },
    };
  }
  
  /**
   * Main entry point: compute drift intelligence
   */
  async computeDriftIntelligence(params: {
    symbol?: string;
    windowDays?: number;
  }): Promise<DriftIntelligenceResponse> {
    const symbol = params.symbol || 'BTC';
    const windowDays = params.windowDays || 90;
    const asOf = new Date().toISOString().split('T')[0];
    
    // Fetch all cohorts
    const [liveOutcomes, v2020Outcomes, v2014Outcomes] = await Promise.all([
      this.queryOutcomes({ symbol, cohort: 'LIVE', windowDays }),
      this.queryOutcomes({ symbol, cohort: 'V2020' }),
      this.queryOutcomes({ symbol, cohort: 'V2014' }),
    ]);
    
    const cohortData: Record<CohortId, any[]> = {
      LIVE: liveOutcomes,
      V2020: v2020Outcomes,
      V2014: v2014Outcomes,
    };
    
    // Compute metrics for each cohort
    const liveMetrics = computeMetrics(liveOutcomes);
    const v2020Metrics = computeMetrics(v2020Outcomes);
    const v2014Metrics = computeMetrics(v2014Outcomes);
    
    // Build cohort blocks
    const live: CohortMetricsBlock = {
      cohortId: 'LIVE',
      metrics: liveMetrics,
      coverage: this.buildCoverage(liveOutcomes),
    };
    
    const baselines = {
      V2020: {
        cohortId: 'V2020' as CohortId,
        metrics: v2020Metrics,
        coverage: this.buildCoverage(v2020Outcomes),
      },
      V2014: {
        cohortId: 'V2014' as CohortId,
        metrics: v2014Metrics,
        coverage: this.buildCoverage(v2014Outcomes),
      },
    };
    
    // Compute deltas
    const deltas = {
      LIVE_vs_V2020: computeDelta(liveMetrics, v2020Metrics),
      LIVE_vs_V2014: computeDelta(liveMetrics, v2014Metrics),
      V2020_vs_V2014: computeDelta(v2020Metrics, v2014Metrics),
    };
    
    // Compute verdict
    const confidence = computeConfidence(liveMetrics.samples);
    const insufficientLiveTruth = liveMetrics.samples < THRESHOLDS.CONFIDENCE.LOW;
    
    // Use V2020 as primary baseline
    const { severity, reasons } = computeSeverity(deltas.LIVE_vs_V2020, confidence);
    const recommendedActions = getRecommendedActions(severity, confidence, insufficientLiveTruth);
    
    const verdict: DriftIntelVerdict = {
      severity,
      confidence,
      insufficientLiveTruth,
      reasons,
      recommendedActions,
    };
    
    // Build breakdowns
    const breakdowns = {
      byTier: buildBreakdown(cohortData, 'tier') as TierBreakdown[],
      byRegime: buildBreakdown(cohortData, 'regime') as RegimeBreakdown[],
      byDivergence: buildBreakdown(cohortData, 'divergenceGrade') as DivergenceBreakdown[],
    };
    
    return {
      symbol,
      windowDays,
      asOf,
      live,
      baselines,
      deltas,
      verdict,
      breakdowns,
      thresholds: {
        WATCH: THRESHOLDS.WATCH,
        WARN: THRESHOLDS.WARN,
        CRITICAL: THRESHOLDS.CRITICAL,
      },
      meta: {
        computedAt: new Date().toISOString(),
        engineVersion: 'v2.1.0',
      },
    };
  }
}

export const driftIntelligenceService = new DriftIntelligenceService();

export default driftIntelligenceService;
