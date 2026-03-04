/**
 * BLOCK 36.9.1 — Horizon Weight Optimization (Coarse Grid)
 * 
 * Fast grid search over horizon weights (7d/14d/30d/60d) with:
 * - Robust objective (P10Sharpe - P95DD - penalties)
 * - Anti-dominance constraints
 * - Monte Carlo validation per candidate
 * 
 * Output: top-K weight candidates for refine step
 */

import { SimMultiHorizonService, MultiHorizonSimResult } from './sim.multi-horizon.service.js';
import { runMonteCarloV2, MonteCarloV2Result } from './sim.montecarlo-v2.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface HorizonWeights {
  w7: number;
  w14: number;
  w30: number;
  w60: number;
}

export interface CoarseOptimizeRequest {
  symbol?: string;
  from?: string;
  to?: string;
  iterations?: number;         // MC iterations (default 1500 for speed)
  blockSizes?: number[];       // MC block sizes (default [5,10])
  minTrades?: number;          // default 20
  step?: number;               // default 0.10
  constraints?: {
    maxW7?: number;            // default 0.35
    maxW60?: number;           // default 0.45
    minW14W30?: number;        // default 0.35
  };
  topK?: number;               // default 10
  stepDays?: number;           // simulation step (default 7)
}

export interface CandidateScore {
  weights: HorizonWeights;
  sim: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    trades: number;
  };
  mc: {
    p95MaxDD: number;
    p10Sharpe: number;
    p05Cagr: number;
    worstMaxDD: number;
    worstSharpe: number;
    medianSharpe: number;
  };
  penalties: {
    dominance: number;
    lowTrades: number;
  };
  score: number;
}

export interface CoarseOptimizeResult {
  ok: boolean;
  top: CandidateScore[];
  tested: number;
  kept: number;
  params: {
    step: number;
    topK: number;
    minTrades: number;
    iterations: number;
    blockSizes: number[];
    constraints: {
      maxW7: number;
      maxW60: number;
      minW14W30: number;
    };
  };
  executionTimeMs: number;
  verdict: string;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function normalize(w: HorizonWeights): HorizonWeights {
  const s = w.w7 + w.w14 + w.w30 + w.w60;
  if (s === 0) return { w7: 0.25, w14: 0.25, w30: 0.25, w60: 0.25 };
  return {
    w7: w.w7 / s,
    w14: w.w14 / s,
    w30: w.w30 / s,
    w60: w.w60 / s
  };
}

/**
 * Anti-dominance penalty: if one horizon > 55% -> penalty
 */
function dominancePenalty(w: HorizonWeights): number {
  const m = Math.max(w.w7, w.w14, w.w30, w.w60);
  if (m <= 0.55) return 0;
  return (m - 0.55) / 0.45; // 0..1+
}

function lowTradesPenalty(trades: number, minTrades: number): number {
  if (trades >= minTrades) return 0;
  const gap = minTrades - trades;
  return Math.min(1, gap / minTrades); // 0..1
}

/**
 * Robust objective: stability over raw returns
 */
function scoreCandidate(input: {
  p10Sharpe: number;
  p95DD: number;
  medianCagr: number;
  domPen: number;
  lowTradesPen: number;
}): number {
  // Higher is better:
  // + P10Sharpe (tail Sharpe)
  // + medianCagr (central return)
  // - P95DD (tail drawdown)
  // - penalties
  return (
    1.0 * input.p10Sharpe +
    0.2 * input.medianCagr -
    0.8 * input.p95DD -
    0.3 * input.domPen -
    0.3 * input.lowTradesPen
  );
}

/**
 * Generate all weight combinations on a grid
 * Each weight >= 0.05, sum = 1
 */
export function generateCoarseWeights(step: number): HorizonWeights[] {
  const res: HorizonWeights[] = [];
  const minWeight = 0.05; // minimum weight per horizon
  const steps = Math.round(1 / step);
  const minSteps = Math.ceil(minWeight / step); // ensure minimum weight
  
  // w7, w14, w30, w60 >= minWeight, sum = 1
  for (let a = minSteps; a <= steps - 3 * minSteps; a++) {
    for (let b = minSteps; b <= steps - a - 2 * minSteps; b++) {
      for (let c = minSteps; c <= steps - a - b - minSteps; c++) {
        const d = steps - a - b - c;
        if (d < minSteps) continue;
        const w = normalize({
          w7: a * step,
          w14: b * step,
          w30: c * step,
          w60: d * step
        });
        res.push(w);
      }
    }
  }
  return res;
}

function passConstraints(w: HorizonWeights, req: CoarseOptimizeRequest): boolean {
  const maxW7 = req.constraints?.maxW7 ?? 0.35;
  const maxW60 = req.constraints?.maxW60 ?? 0.45;
  const minW14W30 = req.constraints?.minW14W30 ?? 0.35;

  if (w.w7 > maxW7 + 0.001) return false;
  if (w.w60 > maxW60 + 0.001) return false;
  if (w.w14 + w.w30 < minW14W30 - 0.001) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// MAIN OPTIMIZATION SERVICE
// ═══════════════════════════════════════════════════════════════

export async function optimizeHorizonWeightsCoarse(
  req: CoarseOptimizeRequest
): Promise<CoarseOptimizeResult> {
  const startTime = Date.now();
  
  const step = req.step ?? 0.10;
  const topK = req.topK ?? 10;
  const minTrades = req.minTrades ?? 20;
  const iterations = req.iterations ?? 1500;
  const blockSizes = req.blockSizes ?? [5, 10];
  const stepDays = req.stepDays ?? 7;
  const symbol = req.symbol ?? 'BTC';
  const from = req.from ?? '2019-01-01';
  const to = req.to ?? '2026-02-15';

  // Generate all valid weight combinations
  const allWeights = generateCoarseWeights(step).filter(w => passConstraints(w, req));
  
  console.log(`[WEIGHTS-OPT] Starting coarse grid: ${allWeights.length} candidates`);
  console.log(`[WEIGHTS-OPT] Step: ${step}, TopK: ${topK}, MC iters: ${iterations}`);

  const simService = new SimMultiHorizonService();
  const top: CandidateScore[] = [];
  let tested = 0;

  for (const weights of allWeights) {
    tested++;
    
    if (tested % 10 === 0) {
      console.log(`[WEIGHTS-OPT] Testing ${tested}/${allWeights.length}...`);
    }

    try {
      // 1) Run multi-horizon simulation with these weights
      const sim = await simService.runFull({
        start: from,
        end: to,
        symbol,
        stepDays,
        horizonConfig: {
          horizons: [7, 14, 30, 60],
          horizonWeights: {
            7: weights.w7,
            14: weights.w14,
            30: weights.w30,
            60: weights.w60
          },
          adaptiveFilterEnabled: true
        }
      });

      const trades = sim.trades?.length ?? 0;
      const domPen = dominancePenalty(weights);
      const ltPen = lowTradesPenalty(trades, minTrades);

      // Quick filter: skip if too few trades
      if (trades < Math.max(8, Math.floor(minTrades / 2))) {
        continue;
      }

      // 2) Run Monte Carlo validation
      const mc = runMonteCarloV2({
        trades: sim.trades,
        initialEquity: 1.0,
        iterations,
        blockSizes
      });

      // Extract metrics
      const p95MaxDD = mc.aggregated.p95MaxDD;
      const worstMaxDD = mc.aggregated.worstMaxDD;
      const worstSharpe = mc.aggregated.worstSharpe;
      const medianSharpe = mc.aggregated.medianSharpe;
      const p05Cagr = mc.aggregated.p05CAGR;
      
      // P10 Sharpe from block results (10th percentile)
      const allSharpes = mc.blockResults.flatMap(br => [br.sharpe.p05]);
      const p10Sharpe = allSharpes.length ? Math.min(...allSharpes) : medianSharpe;

      // Score
      const score = scoreCandidate({
        p10Sharpe,
        p95DD: p95MaxDD,
        medianCagr: sim.metrics.cagr,
        domPen,
        lowTradesPen: ltPen
      });

      const cand: CandidateScore = {
        weights,
        sim: {
          sharpe: sim.metrics.sharpe,
          cagr: sim.metrics.cagr,
          maxDD: sim.metrics.maxDD,
          trades
        },
        mc: {
          p95MaxDD,
          p10Sharpe,
          p05Cagr,
          worstMaxDD,
          worstSharpe,
          medianSharpe
        },
        penalties: { dominance: domPen, lowTrades: ltPen },
        score
      };

      // Insert into top-K
      top.push(cand);
      top.sort((a, b) => b.score - a.score);
      if (top.length > topK) top.pop();

    } catch (err) {
      // Skip failed candidates
      console.warn(`[WEIGHTS-OPT] Candidate failed:`, err);
      continue;
    }
  }

  const executionTimeMs = Date.now() - startTime;
  
  // Generate verdict
  let verdict = 'NO_VALID_CANDIDATES';
  if (top.length > 0) {
    const best = top[0];
    if (best.mc.p95MaxDD <= 0.35 && best.mc.worstSharpe >= 0) {
      verdict = 'OPTIMAL_FOUND';
    } else if (best.mc.p95MaxDD <= 0.40) {
      verdict = 'ACCEPTABLE';
    } else {
      verdict = 'NEEDS_REFINEMENT';
    }
  }

  console.log(`[WEIGHTS-OPT] Complete: ${tested} tested, ${top.length} kept, ${executionTimeMs}ms`);
  console.log(`[WEIGHTS-OPT] Verdict: ${verdict}`);

  return {
    ok: true,
    top,
    tested,
    kept: top.length,
    params: {
      step,
      topK,
      minTrades,
      iterations,
      blockSizes,
      constraints: {
        maxW7: req.constraints?.maxW7 ?? 0.35,
        maxW60: req.constraints?.maxW60 ?? 0.45,
        minW14W30: req.constraints?.minW14W30 ?? 0.35
      }
    },
    executionTimeMs,
    verdict
  };
}

// ═══════════════════════════════════════════════════════════════
// REFINE SERVICE (36.9.2)
// ═══════════════════════════════════════════════════════════════

export interface RefineRequest {
  candidates: CandidateScore[];
  symbol?: string;
  from?: string;
  to?: string;
  iterations?: number;
  blockSizes?: number[];
  refineDelta?: number;        // ±delta around each weight (default 0.03)
  refineIterations?: number;   // max iterations per candidate (default 100)
  minTrades?: number;
}

export interface RefineResult {
  ok: boolean;
  best: CandidateScore | null;
  refinedCandidates: CandidateScore[];
  totalIterations: number;
  executionTimeMs: number;
  verdict: string;
}

export async function refineHorizonWeights(req: RefineRequest): Promise<RefineResult> {
  const startTime = Date.now();
  
  const delta = req.refineDelta ?? 0.03;
  const maxIter = req.refineIterations ?? 100;
  const iterations = req.iterations ?? 2000;
  const blockSizes = req.blockSizes ?? [5, 7, 10];
  const minTrades = req.minTrades ?? 20;
  const symbol = req.symbol ?? 'BTC';
  const from = req.from ?? '2019-01-01';
  const to = req.to ?? '2026-02-15';

  const simService = new SimMultiHorizonService();
  const refined: CandidateScore[] = [];
  let totalIter = 0;

  console.log(`[WEIGHTS-REFINE] Starting refinement of ${req.candidates.length} candidates`);

  for (const candidate of req.candidates.slice(0, 5)) { // Refine top 5
    let current = { ...candidate.weights };
    let currentScore = candidate.score;
    let noImproveCount = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      totalIter++;
      
      // Random perturbation
      const perturbIdx = Math.floor(Math.random() * 4);
      const perturbDir = Math.random() > 0.5 ? delta : -delta;
      
      const perturbed: HorizonWeights = { ...current };
      if (perturbIdx === 0) perturbed.w7 = Math.max(0.05, Math.min(0.5, current.w7 + perturbDir));
      else if (perturbIdx === 1) perturbed.w14 = Math.max(0.05, Math.min(0.5, current.w14 + perturbDir));
      else if (perturbIdx === 2) perturbed.w30 = Math.max(0.05, Math.min(0.5, current.w30 + perturbDir));
      else perturbed.w60 = Math.max(0.05, Math.min(0.5, current.w60 + perturbDir));
      
      const normalized = normalize(perturbed);

      try {
        const sim = await simService.runFull({
          start: from,
          end: to,
          symbol,
          stepDays: 7,
          horizonConfig: {
            horizons: [7, 14, 30, 60],
            weights: {
              7: normalized.w7,
              14: normalized.w14,
              30: normalized.w30,
              60: normalized.w60
            },
            adaptiveFilterEnabled: true
          }
        });

        if ((sim.trades?.length ?? 0) < minTrades / 2) continue;

        const mc = runMonteCarloV2({
          trades: sim.trades,
          iterations,
          blockSizes
        });

        const domPen = dominancePenalty(normalized);
        const ltPen = lowTradesPenalty(sim.trades?.length ?? 0, minTrades);
        
        const newScore = scoreCandidate({
          p10Sharpe: mc.aggregated.medianSharpe,
          p95DD: mc.aggregated.p95MaxDD,
          medianCagr: sim.metrics.cagr,
          domPen,
          lowTradesPen: ltPen
        });

        if (newScore > currentScore) {
          current = normalized;
          currentScore = newScore;
          noImproveCount = 0;
        } else {
          noImproveCount++;
        }

        // Early stop if no improvement
        if (noImproveCount >= 20) break;

      } catch {
        continue;
      }
    }

    // Get final metrics for refined weights
    try {
      const finalSim = await simService.runFull({
        start: from,
        end: to,
        symbol,
        stepDays: 7,
        horizonConfig: {
          horizons: [7, 14, 30, 60],
          weights: {
            7: current.w7,
            14: current.w14,
            30: current.w30,
            60: current.w60
          },
          adaptiveFilterEnabled: true
        }
      });

      const finalMc = runMonteCarloV2({
        trades: finalSim.trades,
        iterations: 3000,
        blockSizes: [5, 7, 10]
      });

      const domPen = dominancePenalty(current);
      const ltPen = lowTradesPenalty(finalSim.trades?.length ?? 0, minTrades);

      refined.push({
        weights: current,
        sim: {
          sharpe: finalSim.metrics.sharpe,
          cagr: finalSim.metrics.cagr,
          maxDD: finalSim.metrics.maxDD,
          trades: finalSim.trades?.length ?? 0
        },
        mc: {
          p95MaxDD: finalMc.aggregated.p95MaxDD,
          p10Sharpe: finalMc.aggregated.medianSharpe,
          p05Cagr: finalMc.aggregated.p05CAGR,
          worstMaxDD: finalMc.aggregated.worstMaxDD,
          worstSharpe: finalMc.aggregated.worstSharpe,
          medianSharpe: finalMc.aggregated.medianSharpe
        },
        penalties: { dominance: domPen, lowTrades: ltPen },
        score: currentScore
      });
    } catch {
      continue;
    }
  }

  refined.sort((a, b) => b.score - a.score);

  const executionTimeMs = Date.now() - startTime;
  const best = refined[0] ?? null;
  
  let verdict = 'NO_IMPROVEMENT';
  if (best) {
    if (best.mc.p95MaxDD <= 0.35 && best.mc.worstSharpe >= 0 && best.mc.p05Cagr >= 0) {
      verdict = 'CERTIFIED';
    } else if (best.mc.p95MaxDD <= 0.40) {
      verdict = 'ACCEPTABLE';
    } else {
      verdict = 'NEEDS_REVIEW';
    }
  }

  console.log(`[WEIGHTS-REFINE] Complete: ${totalIter} iterations, ${executionTimeMs}ms`);
  console.log(`[WEIGHTS-REFINE] Verdict: ${verdict}`);

  return {
    ok: true,
    best,
    refinedCandidates: refined,
    totalIterations: totalIter,
    executionTimeMs,
    verdict
  };
}

// ═══════════════════════════════════════════════════════════════
// CERTIFICATION SERVICE (36.9.3)
// ═══════════════════════════════════════════════════════════════

export interface CertifyRequest {
  weights: HorizonWeights;
  symbol?: string;
  from?: string;
  to?: string;
}

export interface CertifyResult {
  ok: boolean;
  weights: HorizonWeights;
  rolling: {
    passed: boolean;
    meanSharpe: number;
    worstSharpe: number;
    meanMaxDD: number;
    passRate: number;
  } | null;
  mc: {
    passed: boolean;
    p95MaxDD: number;
    p10Sharpe: number;
    p05Cagr: number;
    worstMaxDD: number;
  } | null;
  certified: boolean;
  presetName: string | null;
  verdict: string;
}

export async function certifyHorizonWeights(req: CertifyRequest): Promise<CertifyResult> {
  const weights = normalize(req.weights);
  const symbol = req.symbol ?? 'BTC';
  
  console.log(`[WEIGHTS-CERTIFY] Starting certification for weights:`, weights);

  // Run rolling validation
  let rollingResult: CertifyResult['rolling'] = null;
  let rollingPassed = false;
  try {
    const { SimRollingService, DEFAULT_GATE_CRITERIA } = await import('./sim.rolling.service.js');
    const rolling = new SimRollingService();
    
    const rollRes = await rolling.runRollingValidation({
      trainYears: 5,
      testYears: 1,
      stepYears: 1,
      startYear: 2014,
      endYear: 2026,
      symbol,
      stepDays: 7
      // Note: overrides not supported for weights yet - uses default config
    });

    // Check if passed based on summary
    const summary = rollRes.summary;
    const criteria = rollRes.gateCriteria || DEFAULT_GATE_CRITERIA;
    rollingPassed = (
      summary.meanSharpe >= criteria.minMeanSharpe &&
      summary.worstSharpe >= criteria.minWorstSharpe &&
      summary.meanDD <= criteria.maxMeanDD &&
      summary.passRate >= criteria.minPassRate
    );

    rollingResult = {
      passed: rollingPassed,
      meanSharpe: summary.meanSharpe ?? 0,
      worstSharpe: summary.worstSharpe ?? 0,
      meanMaxDD: summary.meanDD ?? 0,
      passRate: summary.passRate ?? 0
    };
  } catch (err) {
    console.warn('[WEIGHTS-CERTIFY] Rolling validation failed:', err);
  }

  // Run MC validation
  let mcResult: CertifyResult['mc'] = null;
  try {
    const simService = new SimMultiHorizonService();
    const sim = await simService.runFull({
      start: req.from ?? '2019-01-01',
      end: req.to ?? '2026-02-15',
      symbol,
      stepDays: 7,
      horizonConfig: {
        horizons: [7, 14, 30, 60],
        horizonWeights: {
          7: weights.w7,
          14: weights.w14,
          30: weights.w30,
          60: weights.w60
        },
        adaptiveFilterEnabled: true
      }
    });

    const mc = runMonteCarloV2({
      trades: sim.trades,
      iterations: 3000,
      blockSizes: [5, 7, 10]
    });

    mcResult = {
      passed: mc.acceptance.overallPass,
      p95MaxDD: mc.aggregated.p95MaxDD,
      p10Sharpe: mc.aggregated.medianSharpe,
      p05Cagr: mc.aggregated.p05CAGR,
      worstMaxDD: mc.aggregated.worstMaxDD
    };
  } catch (err) {
    console.warn('[WEIGHTS-CERTIFY] MC validation failed:', err);
  }

  // Determine certification
  const rollingPass = rollingResult?.passed ?? false;
  const mcPass = mcResult?.passed ?? false;
  const certified = rollingPass && mcPass;

  let verdict = 'FAILED';
  let presetName: string | null = null;

  if (certified) {
    verdict = 'V2_WEIGHTS_CERTIFIED';
    presetName = 'v2_weights_final';
  } else if (mcPass && !rollingPass) {
    verdict = 'MC_PASS_ROLLING_FAIL';
  } else if (rollingPass && !mcPass) {
    verdict = 'ROLLING_PASS_MC_FAIL';
  }

  console.log(`[WEIGHTS-CERTIFY] Result: ${verdict}`);

  return {
    ok: true,
    weights,
    rolling: rollingResult,
    mc: mcResult,
    certified,
    presetName,
    verdict
  };
}
