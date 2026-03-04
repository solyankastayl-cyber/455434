/**
 * BLOCK 78.1 — Drift Intelligence Service
 * 
 * Core service for cohort drift analysis.
 * Compares LIVE vs V2020, LIVE vs V2014, V2014 vs V2020.
 */

import { PredictionOutcomeModel } from '../memory/outcome/prediction-outcome.model.js';
import {
  DriftPayload,
  DriftScope,
  DriftComparison,
  DriftPair,
  DriftBreakdown,
  DriftBreakdownEntry,
  DriftSeverity,
  DriftReason,
} from './drift.types.js';
import { computeSimpleStats, computeDeltas, groupOutcomesByField, SimpleStats } from './drift.metrics.js';
import { scoreSeverity, detectReasons, determineRecommendation, THRESHOLDS } from './drift.severity.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DRIFT_PAIRS: Array<{ pair: DriftPair; cohortA: string; cohortB: string }> = [
  { pair: 'LIVE_V2020', cohortA: 'LIVE', cohortB: 'V2020' },
  { pair: 'LIVE_V2014', cohortA: 'LIVE', cohortB: 'V2014' },
  { pair: 'V2014_V2020', cohortA: 'V2014', cohortB: 'V2020' },
];

const BREAKDOWN_FIELDS = ['tier', 'volRegime', 'phaseType', 'divergenceGrade'];

// ═══════════════════════════════════════════════════════════════
// DRIFT SERVICE
// ═══════════════════════════════════════════════════════════════

class DriftService {
  /**
   * Build complete drift analysis
   */
  async build(scope: DriftScope): Promise<DriftPayload> {
    const asof = new Date().toISOString();
    const computedAt = new Date().toISOString();
    
    // Fetch outcomes for each cohort
    const [liveOutcomes, v2020Outcomes, v2014Outcomes] = await Promise.all([
      this.queryOutcomes({ ...scope, cohort: 'LIVE', source: 'LIVE' }),
      this.queryOutcomes({ ...scope, cohort: 'V2020', source: 'BOOTSTRAP' }),
      this.queryOutcomes({ ...scope, cohort: 'V2014', source: 'BOOTSTRAP' }),
    ]);
    
    const cohortData: Record<string, any[]> = {
      LIVE: liveOutcomes,
      V2020: v2020Outcomes,
      V2014: v2014Outcomes,
    };
    
    // Build top-level comparisons
    const comparisons = this.buildComparisons(cohortData);
    
    // Build breakdown by tier/regime/phase/divergence
    const breakdown = this.buildBreakdown(cohortData);
    
    // Determine overall verdict
    const allReasons = comparisons.flatMap(c => c.reasons);
    const severityOrder: Record<DriftSeverity, number> = { OK: 0, WATCH: 1, WARN: 2, CRITICAL: 3 };
    const overallSeverity = comparisons.reduce<DriftSeverity>(
      (acc, c) => severityOrder[c.severity] > severityOrder[acc] ? c.severity : acc,
      'OK'
    );
    
    const hasLiveSamples = liveOutcomes.length >= THRESHOLDS.MIN_LIVE_SAMPLES;
    const { recommendation, notes, blockedActions } = determineRecommendation(
      overallSeverity,
      hasLiveSamples,
      allReasons as DriftReason[]
    );
    
    return {
      symbol: 'BTC',
      asof,
      scope,
      comparisons,
      breakdown,
      verdict: {
        overallSeverity,
        recommendation: recommendation as any,
        notes,
        blockedActions,
      },
      meta: {
        totalLiveSamples: liveOutcomes.length,
        totalV2020Samples: v2020Outcomes.length,
        totalV2014Samples: v2014Outcomes.length,
        computedAt,
      },
    };
  }
  
  /**
   * Query outcomes from MongoDB
   */
  private async queryOutcomes(params: {
    symbol: string;
    focus?: string;
    preset?: string;
    role?: string;
    cohort: string;
    source: string;
    windowDays?: number;
  }): Promise<any[]> {
    const query: any = {
      symbol: params.symbol,
    };
    
    // Filter by cohort for BOOTSTRAP data
    if (params.cohort === 'LIVE') {
      query.source = 'LIVE';
    } else {
      // V2014 or V2020 - filter by cohort
      query.source = 'BOOTSTRAP';
      query.cohort = params.cohort;
    }
    
    // Optional filters - skip if 'all'
    if (params.focus && params.focus !== 'all') {
      query.focus = params.focus;
    }
    if (params.preset && params.preset !== 'all') {
      query.preset = params.preset;
    }
    if (params.role && params.role !== 'all') {
      query.role = params.role;
    }
    
    // Window filter - look back from today
    // For BOOTSTRAP data, don't apply window filter (historical data)
    if (params.cohort === 'LIVE' && params.windowDays && params.windowDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - params.windowDays);
      query.asofDate = { $gte: cutoff.toISOString().slice(0, 10) };
    }
    // For bootstrap cohorts, get all available data
    
    console.log(`[Drift] Querying outcomes: ${JSON.stringify(query)}`);
    
    const outcomes = await PredictionOutcomeModel.find(query)
      .sort({ asofDate: -1 })
      .limit(10000)
      .lean();
    
    console.log(`[Drift] Found ${outcomes.length} outcomes for cohort ${params.cohort}`);
    
    return outcomes;
  }
  
  /**
   * Build comparisons for all pairs
   */
  private buildComparisons(cohortData: Record<string, any[]>): DriftComparison[] {
    return DRIFT_PAIRS.map(({ pair, cohortA, cohortB }) => {
      const outcomesA = cohortData[cohortA] || [];
      const outcomesB = cohortData[cohortB] || [];
      
      const statsA = computeSimpleStats(outcomesA);
      const statsB = computeSimpleStats(outcomesB);
      const deltas = computeDeltas(statsA, statsB);
      const reasons = detectReasons(deltas, statsA.n, statsB.n, statsA, statsB);
      const severity = scoreSeverity(deltas, reasons, statsA.n, statsB.n);
      
      return {
        pair,
        cohortA,
        cohortB,
        sample: {
          a: statsA.n,
          b: statsB.n,
          minRequiredLive: THRESHOLDS.MIN_LIVE_SAMPLES,
        },
        deltas,
        severity,
        reasons,
      };
    });
  }
  
  /**
   * Build breakdown by dimension
   */
  private buildBreakdown(cohortData: Record<string, any[]>): DriftBreakdown {
    const breakdown: DriftBreakdown = {
      tier: {},
      regime: {},
      phase: {},
      divergenceGrade: {},
    };
    
    // Tier breakdown
    breakdown.tier = this.buildDimensionBreakdown(cohortData, 'tier');
    
    // Regime breakdown (volRegime)
    breakdown.regime = this.buildDimensionBreakdown(cohortData, 'volRegime');
    
    // Phase breakdown (phaseType)
    breakdown.phase = this.buildDimensionBreakdown(cohortData, 'phaseType');
    
    // Divergence grade breakdown
    breakdown.divergenceGrade = this.buildDimensionBreakdown(cohortData, 'divergenceGrade');
    
    return breakdown;
  }
  
  /**
   * Build breakdown for a single dimension
   */
  private buildDimensionBreakdown(
    cohortData: Record<string, any[]>,
    field: string
  ): Record<string, DriftBreakdownEntry> {
    const result: Record<string, DriftBreakdownEntry> = {};
    
    // Group each cohort by the field
    const grouped: Record<string, Record<string, any[]>> = {};
    for (const [cohort, outcomes] of Object.entries(cohortData)) {
      grouped[cohort] = groupOutcomesByField(outcomes, field);
    }
    
    // Get all unique values
    const allValues = new Set<string>();
    for (const g of Object.values(grouped)) {
      for (const k of Object.keys(g)) {
        allValues.add(k);
      }
    }
    
    // Build comparisons for each value
    for (const value of allValues) {
      const valueData: Record<string, any[]> = {
        LIVE: grouped.LIVE?.[value] || [],
        V2020: grouped.V2020?.[value] || [],
        V2014: grouped.V2014?.[value] || [],
      };
      
      const comparisons = this.buildComparisons(valueData);
      
      const severityOrder: Record<DriftSeverity, number> = { OK: 0, WATCH: 1, WARN: 2, CRITICAL: 3 };
      const worstSeverity = comparisons.reduce<DriftSeverity>(
        (acc, c) => severityOrder[c.severity] > severityOrder[acc] ? c.severity : acc,
        'OK'
      );
      
      result[value] = {
        key: value,
        comparisons,
        worstSeverity,
      };
    }
    
    return result;
  }
}

export const driftService = new DriftService();
export default driftService;
