/**
 * Dataset Label Builder
 * 
 * ETAP 3.4: Pure functions for building labels from truth data.
 * 
 * NO DB calls - NO Date.now() - DETERMINISTIC
 */
import type { ITrendValidation } from '../models/trend_validation.model.js';
import type { IOutcomeObservation } from '../models/OutcomeObservation.model.js';
import type { IAttributionOutcomeLink } from '../models/attribution_outcome_link.model.js';
import type { TrendLabel, DelayLabel } from '../types/trend.types.js';
import type { Verdict } from '../types/attribution.types.js';
import type {
  Labels,
  TrendLabels,
  DelayLabels,
  OutcomeLabels,
  VerdictLabels,
} from '../types/dataset.types.js';

// ==================== LABEL BUILDERS ====================

/**
 * Build trend labels from TrendValidation
 */
export function buildTrendLabels(trend: ITrendValidation | null): TrendLabels {
  if (!trend) {
    return {
      trend_1d: null,
      trend_7d: null,
      trend_30d: null,
    };
  }
  
  return {
    trend_1d: (trend.horizons?.['1d']?.label as TrendLabel) || null,
    trend_7d: (trend.horizons?.['7d']?.label as TrendLabel) || null,
    trend_30d: (trend.horizons?.['30d']?.label as TrendLabel) || null,
  };
}

/**
 * Build delay labels from TrendValidation
 */
export function buildDelayLabels(trend: ITrendValidation | null): DelayLabels {
  if (!trend) {
    return {
      delayClass_7d: null,
      delayClass_30d: null,
    };
  }
  
  // Delay class for 7d - was there no 1d trend but 7d trend?
  const h1d = trend.horizons?.['1d']?.label;
  const h7d = trend.horizons?.['7d']?.label;
  const h30d = trend.horizons?.['30d']?.label;
  
  const h1dTrend = h1d === 'TREND_UP' || h1d === 'TREND_DOWN';
  const h7dTrend = h7d === 'TREND_UP' || h7d === 'TREND_DOWN';
  const h30dTrend = h30d === 'TREND_UP' || h30d === 'TREND_DOWN';
  
  let delayClass_7d: DelayLabel | null = null;
  let delayClass_30d: DelayLabel | null = null;
  
  // 7d delay classification
  if (h7dTrend) {
    delayClass_7d = h1dTrend ? 'INSTANT' : 'DELAYED';
  } else {
    delayClass_7d = 'NONE';
  }
  
  // 30d delay classification
  if (h30dTrend) {
    if (h1dTrend) {
      delayClass_30d = 'INSTANT';
    } else if (h7dTrend) {
      delayClass_30d = 'DELAYED';
    } else {
      delayClass_30d = 'LATE';
    }
  } else {
    delayClass_30d = 'NONE';
  }
  
  return {
    delayClass_7d,
    delayClass_30d,
  };
}

/**
 * Build outcome labels from OutcomeObservation
 */
export function buildOutcomeLabels(outcome: IOutcomeObservation | null): OutcomeLabels {
  if (!outcome) {
    return {
      ret_1d_pct: null,
      ret_7d_pct: null,
      ret_30d_pct: null,
      maxDrawdown_7d: null,
      maxDrawdown_30d: null,
    };
  }
  
  return {
    ret_1d_pct: outcome.horizons?.['1d']?.returnPct ?? null,
    ret_7d_pct: outcome.horizons?.['7d']?.returnPct ?? null,
    ret_30d_pct: outcome.horizons?.['30d']?.returnPct ?? null,
    maxDrawdown_7d: outcome.horizons?.['7d']?.maxDrawdownPct ?? null,
    maxDrawdown_30d: outcome.horizons?.['30d']?.maxDrawdownPct ?? null,
  };
}

/**
 * Build verdict labels from AttributionOutcomeLinks
 */
export function buildVerdictLabels(
  links: { horizon: string; verdict: Verdict }[]
): VerdictLabels {
  const verdicts: VerdictLabels = {
    verdict_1d: null,
    verdict_7d: null,
    verdict_30d: null,
  };
  
  for (const link of links) {
    if (link.horizon === '1d') {
      verdicts.verdict_1d = link.verdict;
    } else if (link.horizon === '7d') {
      verdicts.verdict_7d = link.verdict;
    } else if (link.horizon === '30d') {
      verdicts.verdict_30d = link.verdict;
    }
  }
  
  return verdicts;
}

/**
 * Build complete labels object
 */
export function buildLabels(
  trend: ITrendValidation | null,
  outcome: IOutcomeObservation | null,
  links: { horizon: string; verdict: Verdict }[]
): Labels {
  return {
    trends: buildTrendLabels(trend),
    delays: buildDelayLabels(trend),
    outcomes: buildOutcomeLabels(outcome),
    verdicts: buildVerdictLabels(links),
  };
}

/**
 * Calculate label coverage metrics
 */
export function calculateLabelCoverage(labels: Labels): {
  trendCoverage: number;
  verdictCoverage: number;
} {
  let trendCount = 0;
  let verdictCount = 0;
  
  if (labels.trends.trend_1d) trendCount++;
  if (labels.trends.trend_7d) trendCount++;
  if (labels.trends.trend_30d) trendCount++;
  
  if (labels.verdicts.verdict_1d) verdictCount++;
  if (labels.verdicts.verdict_7d) verdictCount++;
  if (labels.verdicts.verdict_30d) verdictCount++;
  
  return {
    trendCoverage: trendCount,
    verdictCoverage: verdictCount,
  };
}
