/**
 * A3.7 — 90d Calibration Grid Service
 * 
 * Runs calibration grid for DXY 90d horizon
 * Does NOT modify defaults - only calculates and returns results
 */

import { v4 as uuidv4 } from 'uuid';
import { runWalkForward, resolveWalkOutcomes, recomputeWalkMetrics } from './dxy-walk.service.js';
import { DxyWalkSignalModel } from './models/dxy_walk_signal.model.js';
import { DxyWalkOutcomeModel } from './models/dxy_walk_outcome.model.js';
import { DxyCalibrationRunModel } from './models/dxy_calibration_run.model.js';
import {
  ACCEPTANCE_90D,
  type Grid90dRequest,
  type Grid90dResponse,
  type GridConfigResult,
  type ConfigUsed,
} from './dxy-calibration-90d.types.js';
import type { WeightMode } from './dxy-walk.types.js';

// ═══════════════════════════════════════════════════════════════
// HELPER: Generate all combinations
// ═══════════════════════════════════════════════════════════════

function generateCombinations(grid: Grid90dRequest['grid'], topK: number): ConfigUsed[] {
  const combinations: ConfigUsed[] = [];
  
  for (const windowLen of grid.windowLen) {
    for (const threshold of grid.threshold) {
      for (const weightMode of grid.weightMode) {
        combinations.push({
          windowLen,
          threshold,
          weightMode,
          topK,
          focus: '90d',
        });
      }
    }
  }
  
  return combinations;
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Check if config passes acceptance criteria
// ═══════════════════════════════════════════════════════════════

function checkAcceptance(result: Omit<GridConfigResult, 'passed'>): boolean {
  return (
    result.equityFinal >= ACCEPTANCE_90D.equityFinalMin &&
    result.maxDD <= ACCEPTANCE_90D.maxDDMax &&
    Math.abs(result.bias) <= ACCEPTANCE_90D.biasAbsMax &&
    result.trades >= ACCEPTANCE_90D.tradesMin
  );
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Rank results (higher is better)
// Score = equityFinal * 1000 - maxDD * 100 - abs(bias) * 10 + actionableRate
// ═══════════════════════════════════════════════════════════════

function scoreResult(r: GridConfigResult): number {
  return (
    r.equityFinal * 1000 -
    r.maxDD * 100 -
    Math.abs(r.bias) * 10 +
    r.actionableRate
  );
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Create run key for idempotent storage
// ═══════════════════════════════════════════════════════════════

function createRunKey(req: Grid90dRequest): string {
  const gridStr = [
    req.grid.windowLen.sort().join(','),
    req.grid.threshold.sort().join(','),
    req.grid.weightMode.sort().join(','),
  ].join('|');
  
  return `${req.focus}:${req.oosFrom}:${req.oosTo}:${req.stepDays}:${gridStr}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Run 90d calibration grid
// ═══════════════════════════════════════════════════════════════

export async function runGrid90d(req: Grid90dRequest): Promise<Grid90dResponse> {
  const start = Date.now();
  const runId = uuidv4();
  const runKey = createRunKey(req);
  
  const oosFrom = req.oosFrom;
  const oosTo = req.oosTo;
  const stepDays = req.stepDays ?? 7;
  const topK = req.topK ?? 10;
  
  // Generate all combinations
  const combinations = generateCombinations(req.grid, topK);
  console.log(`[A3.7] Starting 90d grid with ${combinations.length} combinations...`);
  
  const results: GridConfigResult[] = [];
  
  for (let i = 0; i < combinations.length; i++) {
    const config = combinations[i];
    console.log(`[A3.7] Running ${i + 1}/${combinations.length}: windowLen=${config.windowLen}, threshold=${config.threshold}, weightMode=${config.weightMode}`);
    
    try {
      // Clear previous walk data for this config
      await DxyWalkSignalModel.deleteMany({
        windowLen: config.windowLen,
        topK: config.topK,
        threshold: config.threshold,
        horizonDays: 90,
      });
      await DxyWalkOutcomeModel.deleteMany({
        horizonDays: 90,
      });
      
      // Run walk-forward for 90d only
      await runWalkForward({
        from: oosFrom,
        to: oosTo,
        stepDays,
        windowLen: config.windowLen,
        topK: config.topK,
        threshold: config.threshold,
        weightMode: config.weightMode as WeightMode,
        horizons: [90],
        modes: ['HYBRID'],
      });
      
      // Resolve outcomes
      await resolveWalkOutcomes({ from: oosFrom, to: oosTo });
      
      // Get metrics
      const fromDate = new Date(oosFrom);
      const toDate = new Date(oosTo);
      const metrics = await recomputeWalkMetrics('HYBRID', 90, fromDate, toDate);
      
      const configResult: Omit<GridConfigResult, 'passed'> = {
        configUsed: config,
        equityFinal: metrics.equityFinal,
        maxDD: metrics.equityMaxDD,
        hitRate: metrics.hitRate,
        bias: metrics.bias,
        actionableRate: metrics.actionableRate,
        trades: metrics.actionable,
      };
      
      results.push({
        ...configResult,
        passed: checkAcceptance(configResult),
      });
      
    } catch (error: any) {
      console.error(`[A3.7] Error for config:`, config, error.message);
      results.push({
        configUsed: config,
        equityFinal: 0,
        maxDD: 1,
        hitRate: 0,
        bias: 0,
        actionableRate: 0,
        trades: 0,
        passed: false,
      });
    }
  }
  
  // Sort by score (best first)
  results.sort((a, b) => scoreResult(b) - scoreResult(a));
  
  // Get best (must pass acceptance)
  const passedResults = results.filter(r => r.passed);
  const best = passedResults.length > 0 ? passedResults[0] : null;
  
  // Top 5
  const top5 = results.slice(0, 5);
  
  // Save to MongoDB (idempotent by runKey)
  await DxyCalibrationRunModel.updateOne(
    { runKey },
    {
      $set: {
        runId,
        runKey,
        createdAt: new Date(),
        focus: req.focus,
        oosFrom,
        oosTo,
        stepDays,
        gridConfig: {
          windowLen: req.grid.windowLen,
          threshold: req.grid.threshold,
          weightMode: req.grid.weightMode,
          topK,
        },
        results,
        best,
      },
    },
    { upsert: true }
  );
  
  console.log(`[A3.7] Grid complete. ${passedResults.length}/${results.length} passed acceptance.`);
  if (best) {
    console.log(`[A3.7] Best config: windowLen=${best.configUsed.windowLen}, threshold=${best.configUsed.threshold}, weightMode=${best.configUsed.weightMode}`);
    console.log(`[A3.7] Best metrics: equityFinal=${best.equityFinal}, maxDD=${best.maxDD}, hitRate=${best.hitRate}, bias=${best.bias}`);
  }
  
  return {
    ok: true,
    runId,
    oosFrom,
    oosTo,
    stepDays,
    focus: req.focus,
    totalConfigs: combinations.length,
    passedConfigs: passedResults.length,
    results,
    top5,
    best,
    durationMs: Date.now() - start,
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Get latest calibration run
// ═══════════════════════════════════════════════════════════════

export async function getLatestCalibrationRun(focus: string = '90d'): Promise<any> {
  const run = await DxyCalibrationRunModel
    .findOne({ focus })
    .sort({ createdAt: -1 })
    .lean();
  
  return run;
}
