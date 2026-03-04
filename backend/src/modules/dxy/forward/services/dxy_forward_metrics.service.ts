/**
 * DXY FORWARD METRICS SERVICE
 * 
 * D4.4 — Computes and caches forward performance metrics
 * 
 * Hit/Miss Logic:
 * - LONG → hit if realizedReturn > 0
 * - SHORT → hit if realizedReturn < 0
 * - HOLD → excluded from hit rate (coverage metric only)
 * 
 * ISOLATION: DXY only. No BTC/SPX imports.
 */

import { DXY_ASSET, DXY_HORIZON_DAYS } from '../dxy-forward.constants.js';
import { DxyForwardSignalModel } from '../models/dxy_forward_signal.model.js';
import { DxyForwardOutcomeModel } from '../models/dxy_forward_outcome.model.js';
import { DxyForwardMetricsModel } from '../models/dxy_forward_metrics.model.js';
import type { DxyForwardSignal, DxyForwardOutcome, DxyForwardMetrics } from '../dxy-forward.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MetricsSummary {
  asset: string;
  window: string;
  horizonDays: number;
  sampleCount: number;
  actionableCount: number;
  holdCount: number;
  hitRate: number;
  avgReturn: number;
  bias: number;
  maxDrawdown: number;
  lastUpdated: string;
}

export interface FullSummary {
  asset: string;
  overall: {
    totalSignals: number;
    totalOutcomes: number;
    actionableResolved: number;
    hitRate: number;
    avgReturn: number;
    bias: number;
  };
  byHorizon: MetricsSummary[];
}

// ═══════════════════════════════════════════════════════════════
// HIT/MISS CALCULATION
// ═══════════════════════════════════════════════════════════════

function isHit(action: string, realizedReturn: number): boolean {
  if (action === 'LONG') return realizedReturn > 0;
  if (action === 'SHORT') return realizedReturn < 0;
  return false; // HOLD doesn't count
}

function isActionable(action: string): boolean {
  return action === 'LONG' || action === 'SHORT';
}

// ═══════════════════════════════════════════════════════════════
// COMPUTE METRICS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute metrics for a specific horizon and time window
 */
export async function computeMetrics(params: {
  horizonDays: number;
  window?: 'ALL' | '1Y' | '5Y' | '10Y';
}): Promise<MetricsSummary | null> {
  const { horizonDays, window = 'ALL' } = params;
  
  // Get date filter based on window
  let dateFilter: any = {};
  if (window !== 'ALL') {
    const yearsBack = parseInt(window.replace('Y', ''));
    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - yearsBack);
    dateFilter = { asOf: { $gte: cutoffDate.toISOString().slice(0, 10) } };
  }
  
  // Get signals with this horizon
  const signals = await DxyForwardSignalModel
    .find({ asset: DXY_ASSET, horizonDays, ...dateFilter })
    .lean() as DxyForwardSignal[];
  
  if (signals.length === 0) {
    return null;
  }
  
  // Get corresponding outcomes
  const outcomes = await DxyForwardOutcomeModel
    .find({ asset: DXY_ASSET, horizonDays, isResolved: true, ...dateFilter })
    .lean() as DxyForwardOutcome[];
  
  // Build outcome map
  const outcomeMap = new Map<string, DxyForwardOutcome>();
  for (const o of outcomes) {
    outcomeMap.set(o.asOf, o);
  }
  
  // Calculate metrics
  let hits = 0;
  let actionableCount = 0;
  let holdCount = 0;
  let totalReturn = 0;
  let totalBias = 0;
  let biasCount = 0;
  
  // For drawdown calculation
  const returns: number[] = [];
  
  for (const signal of signals) {
    const outcome = outcomeMap.get(signal.asOf);
    
    if (!outcome) continue;
    
    if (isActionable(signal.action)) {
      actionableCount++;
      
      if (isHit(signal.action, outcome.realizedReturn)) {
        hits++;
      }
      
      totalReturn += outcome.realizedReturn;
      returns.push(outcome.realizedReturn);
      
      // Bias = realized - forecast
      totalBias += outcome.realizedReturn - signal.forecastReturn;
      biasCount++;
    } else {
      holdCount++;
    }
  }
  
  // Calculate hit rate
  const hitRate = actionableCount > 0 ? hits / actionableCount : 0;
  
  // Calculate average return
  const avgReturn = actionableCount > 0 ? totalReturn / actionableCount : 0;
  
  // Calculate bias
  const bias = biasCount > 0 ? totalBias / biasCount : 0;
  
  // Calculate max drawdown
  const maxDrawdown = calculateMaxDrawdown(returns);
  
  return {
    asset: DXY_ASSET,
    window,
    horizonDays,
    sampleCount: signals.length,
    actionableCount,
    holdCount,
    hitRate: Math.round(hitRate * 10000) / 10000,
    avgReturn: Math.round(avgReturn * 10000) / 10000,
    bias: Math.round(bias * 10000) / 10000,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 10000,
    lastUpdated: new Date().toISOString(),
  };
}

function calculateMaxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;
  
  let equity = 1;
  let peak = 1;
  let maxDD = 0;
  
  for (const r of returns) {
    equity *= (1 + r);
    if (equity > peak) peak = equity;
    
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  
  return maxDD;
}

// ═══════════════════════════════════════════════════════════════
// RECOMPUTE ALL METRICS (cache)
// ═══════════════════════════════════════════════════════════════

/**
 * Recompute and cache all metrics
 */
export async function recomputeAllMetrics(): Promise<{
  computed: number;
  cached: number;
}> {
  const windows: Array<'ALL' | '1Y' | '5Y' | '10Y'> = ['ALL', '1Y', '5Y', '10Y'];
  
  let computed = 0;
  let cached = 0;
  
  for (const window of windows) {
    for (const horizonDays of DXY_HORIZON_DAYS) {
      const metrics = await computeMetrics({ horizonDays, window });
      
      if (metrics) {
        computed++;
        
        await DxyForwardMetricsModel.updateOne(
          { asset: DXY_ASSET, window, horizonDays },
          {
            $set: {
              sampleCount: metrics.sampleCount,
              hitRate: metrics.hitRate,
              avgReturn: metrics.avgReturn,
              bias: metrics.bias,
              maxDrawdown: metrics.maxDrawdown,
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
        
        cached++;
      }
    }
  }
  
  return { computed, cached };
}

// ═══════════════════════════════════════════════════════════════
// GET FULL SUMMARY
// ═══════════════════════════════════════════════════════════════

/**
 * Get full forward performance summary
 */
export async function getFullSummary(window: 'ALL' | '1Y' | '5Y' | '10Y' = 'ALL'): Promise<FullSummary> {
  // Get totals
  const totalSignals = await DxyForwardSignalModel.countDocuments({ asset: DXY_ASSET });
  const totalOutcomes = await DxyForwardOutcomeModel.countDocuments({ asset: DXY_ASSET, isResolved: true });
  
  // Compute metrics for each horizon
  const byHorizon: MetricsSummary[] = [];
  let overallHits = 0;
  let overallActionable = 0;
  let overallReturn = 0;
  let overallBias = 0;
  let overallBiasCount = 0;
  
  for (const horizonDays of DXY_HORIZON_DAYS) {
    const metrics = await computeMetrics({ horizonDays, window });
    
    if (metrics) {
      byHorizon.push(metrics);
      
      overallHits += metrics.hitRate * metrics.actionableCount;
      overallActionable += metrics.actionableCount;
      overallReturn += metrics.avgReturn * metrics.actionableCount;
      overallBias += metrics.bias * metrics.actionableCount;
      overallBiasCount += metrics.actionableCount;
    }
  }
  
  return {
    asset: DXY_ASSET,
    overall: {
      totalSignals,
      totalOutcomes,
      actionableResolved: overallActionable,
      hitRate: overallActionable > 0 ? Math.round((overallHits / overallActionable) * 10000) / 10000 : 0,
      avgReturn: overallActionable > 0 ? Math.round((overallReturn / overallActionable) * 10000) / 10000 : 0,
      bias: overallBiasCount > 0 ? Math.round((overallBias / overallBiasCount) * 10000) / 10000 : 0,
    },
    byHorizon,
  };
}
