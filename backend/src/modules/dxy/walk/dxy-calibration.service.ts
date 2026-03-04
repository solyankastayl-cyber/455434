/**
 * DXY A3.6 CALIBRATION GRID SERVICE
 * 
 * Runs calibration grid tests for threshold, weight mode, and window length
 */

import { runWalkForward, resolveWalkOutcomes, recomputeWalkMetrics } from './dxy-walk.service.js';
import { DxyWalkSignalModel } from './models/dxy_walk_signal.model.js';
import { DxyWalkOutcomeModel } from './models/dxy_walk_outcome.model.js';
import { DxyWalkMetricsModel } from './models/dxy_walk_metrics.model.js';
import type { WeightMode, WalkMode } from './dxy-walk.types.js';

export interface GridConfig {
  threshold: number;
  weightMode: WeightMode;
  windowLen: number;
  topK: number;
}

export interface GridRunResult {
  config: GridConfig;
  horizons: {
    [horizon: number]: {
      synthetic: HorizonMetrics;
      hybrid: HorizonMetrics;
    };
  };
  durationMs: number;
}

export interface HorizonMetrics {
  samples: number;
  actionable: number;
  actionableRate: number;
  hitRate: number;
  avgReturn: number;
  bias: number;
  avgReplayWeight: number;
  replayWeightStd: number;
  equityFinal: number;
  equityMaxDD: number;
}

export interface CalibrationGridResult {
  ok: boolean;
  from: string;
  to: string;
  stepDays: number;
  horizons: number[];
  results: GridRunResult[];
  totalDurationMs: number;
  bestConfig: {
    byHitRate30d: GridConfig | null;
    byMinBias30d: GridConfig | null;
    byWeightStd: GridConfig | null;
  };
}

/**
 * Run a single grid configuration
 */
async function runGridConfig(
  config: GridConfig,
  from: string,
  to: string,
  stepDays: number,
  horizons: number[]
): Promise<GridRunResult> {
  const start = Date.now();
  
  // Clear existing data for this config
  await DxyWalkSignalModel.deleteMany({
    windowLen: config.windowLen,
    topK: config.topK,
    threshold: config.threshold,
  });
  await DxyWalkOutcomeModel.deleteMany({});
  
  // Run walk-forward
  await runWalkForward({
    from,
    to,
    stepDays,
    windowLen: config.windowLen,
    topK: config.topK,
    threshold: config.threshold,
    weightMode: config.weightMode,
    modes: ['SYNTHETIC', 'HYBRID'],
    horizons,
  });
  
  // Resolve outcomes
  await resolveWalkOutcomes({ from, to });
  
  // Collect metrics for each horizon
  const horizonResults: GridRunResult['horizons'] = {};
  
  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  for (const h of horizons) {
    const syntheticMetrics = await recomputeWalkMetrics('SYNTHETIC', h, fromDate, toDate);
    const hybridMetrics = await recomputeWalkMetrics('HYBRID', h, fromDate, toDate);
    
    horizonResults[h] = {
      synthetic: {
        samples: syntheticMetrics.samples,
        actionable: syntheticMetrics.actionable,
        actionableRate: syntheticMetrics.actionableRate,
        hitRate: syntheticMetrics.hitRate,
        avgReturn: syntheticMetrics.avgReturn,
        bias: syntheticMetrics.bias,
        avgReplayWeight: syntheticMetrics.avgReplayWeight,
        replayWeightStd: syntheticMetrics.replayWeightStd,
        equityFinal: syntheticMetrics.equityFinal,
        equityMaxDD: syntheticMetrics.equityMaxDD,
      },
      hybrid: {
        samples: hybridMetrics.samples,
        actionable: hybridMetrics.actionable,
        actionableRate: hybridMetrics.actionableRate,
        hitRate: hybridMetrics.hitRate,
        avgReturn: hybridMetrics.avgReturn,
        bias: hybridMetrics.bias,
        avgReplayWeight: hybridMetrics.avgReplayWeight,
        replayWeightStd: hybridMetrics.replayWeightStd,
        equityFinal: hybridMetrics.equityFinal,
        equityMaxDD: hybridMetrics.equityMaxDD,
      },
    };
  }
  
  return {
    config,
    horizons: horizonResults,
    durationMs: Date.now() - start,
  };
}

/**
 * Run threshold calibration grid (Set A)
 */
export async function runThresholdGrid(
  from: string,
  to: string,
  stepDays: number = 7,
  horizons: number[] = [7, 14, 30, 90],
  thresholds: number[] = [0.001, 0.0025, 0.005, 0.01],
  windowLen: number = 120,
  topK: number = 10
): Promise<CalibrationGridResult> {
  const start = Date.now();
  const results: GridRunResult[] = [];
  
  for (const threshold of thresholds) {
    console.log(`[A3.6 Grid] Running threshold=${threshold}...`);
    const result = await runGridConfig(
      { threshold, weightMode: 'W0', windowLen, topK },
      from, to, stepDays, horizons
    );
    results.push(result);
  }
  
  // Find best configs
  let bestHitRate30d: GridConfig | null = null;
  let bestHitRate = 0;
  let bestMinBias30d: GridConfig | null = null;
  let bestMinBias = Infinity;
  
  for (const r of results) {
    const h30 = r.horizons[30]?.hybrid;
    if (h30) {
      if (h30.hitRate > bestHitRate) {
        bestHitRate = h30.hitRate;
        bestHitRate30d = r.config;
      }
      if (Math.abs(h30.bias) < bestMinBias) {
        bestMinBias = Math.abs(h30.bias);
        bestMinBias30d = r.config;
      }
    }
  }
  
  return {
    ok: true,
    from,
    to,
    stepDays,
    horizons,
    results,
    totalDurationMs: Date.now() - start,
    bestConfig: {
      byHitRate30d: bestHitRate30d,
      byMinBias30d: bestMinBias30d,
      byWeightStd: null,
    },
  };
}

/**
 * Run weight mode calibration grid (Set B)
 */
export async function runWeightModeGrid(
  from: string,
  to: string,
  stepDays: number = 7,
  horizons: number[] = [7, 14, 30, 90],
  threshold: number,
  windowLen: number = 120,
  topK: number = 10
): Promise<CalibrationGridResult> {
  const start = Date.now();
  const results: GridRunResult[] = [];
  const weightModes: WeightMode[] = ['W1', 'W2', 'W3'];
  
  for (const weightMode of weightModes) {
    console.log(`[A3.6 Grid] Running weightMode=${weightMode}...`);
    const result = await runGridConfig(
      { threshold, weightMode, windowLen, topK },
      from, to, stepDays, horizons
    );
    results.push(result);
  }
  
  // Find best config by weight std
  let bestWeightStd: GridConfig | null = null;
  let maxWeightStd = 0;
  let bestHitRate30d: GridConfig | null = null;
  let bestHitRate = 0;
  
  for (const r of results) {
    const h30 = r.horizons[30]?.hybrid;
    if (h30) {
      if (h30.replayWeightStd > maxWeightStd) {
        maxWeightStd = h30.replayWeightStd;
        bestWeightStd = r.config;
      }
      if (h30.hitRate > bestHitRate) {
        bestHitRate = h30.hitRate;
        bestHitRate30d = r.config;
      }
    }
  }
  
  return {
    ok: true,
    from,
    to,
    stepDays,
    horizons,
    results,
    totalDurationMs: Date.now() - start,
    bestConfig: {
      byHitRate30d: bestHitRate30d,
      byMinBias30d: null,
      byWeightStd: bestWeightStd,
    },
  };
}

/**
 * Run window length calibration grid (Set C)
 */
export async function runWindowGrid(
  from: string,
  to: string,
  stepDays: number = 7,
  horizons: number[] = [7, 14, 30, 90],
  threshold: number,
  weightMode: WeightMode,
  topK: number = 10,
  windowLengths: number[] = [120, 180, 240]
): Promise<CalibrationGridResult> {
  const start = Date.now();
  const results: GridRunResult[] = [];
  
  for (const windowLen of windowLengths) {
    console.log(`[A3.6 Grid] Running windowLen=${windowLen}...`);
    const result = await runGridConfig(
      { threshold, weightMode, windowLen, topK },
      from, to, stepDays, horizons
    );
    results.push(result);
  }
  
  // Find best config by hit rate
  let bestHitRate30d: GridConfig | null = null;
  let bestHitRate = 0;
  let bestMinBias30d: GridConfig | null = null;
  let bestMinBias = Infinity;
  
  for (const r of results) {
    const h30 = r.horizons[30]?.hybrid;
    if (h30) {
      if (h30.hitRate > bestHitRate) {
        bestHitRate = h30.hitRate;
        bestHitRate30d = r.config;
      }
      if (Math.abs(h30.bias) < bestMinBias) {
        bestMinBias = Math.abs(h30.bias);
        bestMinBias30d = r.config;
      }
    }
  }
  
  return {
    ok: true,
    from,
    to,
    stepDays,
    horizons,
    results,
    totalDurationMs: Date.now() - start,
    bestConfig: {
      byHitRate30d: bestHitRate30d,
      byMinBias30d: bestMinBias30d,
      byWeightStd: null,
    },
  };
}

/**
 * Format grid results as table
 */
export function formatGridTable(results: GridRunResult[]): string {
  const lines: string[] = [];
  lines.push('Config\t7d\t14d\t30d\t90d\tBias30\tBias90\tAvgW\tStdW\tDD');
  lines.push('─'.repeat(100));
  
  for (const r of results) {
    const cfg = `thr=${r.config.threshold},${r.config.weightMode},win=${r.config.windowLen}`;
    const h7 = r.horizons[7]?.hybrid;
    const h14 = r.horizons[14]?.hybrid;
    const h30 = r.horizons[30]?.hybrid;
    const h90 = r.horizons[90]?.hybrid;
    
    lines.push([
      cfg,
      h7 ? `${(h7.hitRate * 100).toFixed(1)}%` : '-',
      h14 ? `${(h14.hitRate * 100).toFixed(1)}%` : '-',
      h30 ? `${(h30.hitRate * 100).toFixed(1)}%` : '-',
      h90 ? `${(h90.hitRate * 100).toFixed(1)}%` : '-',
      h30 ? h30.bias.toFixed(4) : '-',
      h90 ? h90.bias.toFixed(4) : '-',
      h30 ? h30.avgReplayWeight.toFixed(3) : '-',
      h30 ? h30.replayWeightStd.toFixed(4) : '-',
      h30 ? `${(h30.equityMaxDD * 100).toFixed(1)}%` : '-',
    ].join('\t'));
  }
  
  return lines.join('\n');
}
