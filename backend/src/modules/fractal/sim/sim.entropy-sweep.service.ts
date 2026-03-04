/**
 * BLOCK 36.10.10 — Entropy Guard Sweep Service
 * 
 * 4D grid search for optimal Entropy Guard parameters:
 * - warn: where we start cutting exposure
 * - hard: where we cut to minScale
 * - minScale: floor for exposure multiplier
 * - emaAlpha: entropy smoothing factor
 * 
 * Objective: minimize P95 DD while maintaining decent Sharpe/Trades.
 */

import { SimMultiHorizonCertifyService, CertifyResult } from './sim.multi-horizon.certify.service.js';
import { EntropyGuardConfig, DEFAULT_ENTROPY_GUARD_CONFIG } from '../engine/v2/entropy.guard.js';
import { DEFAULT_MULTI_HORIZON_CONFIG } from '../engine/multi-horizon.engine.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface SweepInput {
  from: string;
  to: string;
  iterations?: number;
  blockSizes?: number[];

  // Grid parameters
  warn?: number[];      // default [0.35, 0.40, 0.45]
  hard?: number[];      // default [0.55, 0.60, 0.65]
  minScale?: number[];  // default [0.35, 0.45, 0.55]
  emaAlpha?: number[];  // default [0.15, 0.25, 0.35]

  // Guardrails
  minTrades?: number;   // default 10
  minSharpe?: number;   // default 0.2
  maxP95DD?: number;    // optional filter
}

export interface SweepCandidate {
  params: {
    warn: number;
    hard: number;
    minScale: number;
    emaAlpha: number;
  };
  wf: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    trades: number;
  };
  mc: {
    p95MaxDD: number;
    worstSharpe: number;
    p05CAGR: number;
    passed: boolean;
  };
  score: number;
  flags: string[];
}

export interface SweepResult {
  ok: boolean;
  count: number;
  gridSize: string;
  best: SweepCandidate | null;
  top: SweepCandidate[];
  executionTimeMs: number;
  recommendation: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class SimEntropySweepService {
  private certify: SimMultiHorizonCertifyService;

  constructor() {
    this.certify = new SimMultiHorizonCertifyService();
  }

  /**
   * Calculate candidate score (lower is better)
   * Prioritizes tail DD reduction while maintaining acceptable Sharpe
   */
  private scoreCand(cand: SweepCandidate, input: SweepInput): void {
    const sharpe = cand.wf.sharpe;
    const trades = cand.wf.trades;
    const p95dd = cand.mc.p95MaxDD;
    const p05cagr = cand.mc.p05CAGR;
    const worstSharpe = cand.mc.worstSharpe;

    const flags: string[] = [];

    // Check guardrails
    if (trades < (input.minTrades ?? 10)) flags.push("LOW_TRADES");
    if (sharpe < (input.minSharpe ?? 0.2)) flags.push("LOW_SHARPE");
    if (input.maxP95DD != null && p95dd > input.maxP95DD) flags.push("HIGH_TAIL_DD");

    // Objective: tail DD dominates, but we still prefer decent sharpe
    // Lower score is better
    const score =
      (p95dd ?? 0.9) * 1.0 +                                           // Main: minimize P95 DD
      Math.max(0, 0.6 - sharpe) * 0.35 +                               // Prefer Sharpe >= 0.6
      Math.max(0, 0.4 - (worstSharpe ?? 0)) * 0.25 +                   // Prefer worst Sharpe >= 0.4
      Math.max(0, 0.03 - (p05cagr ?? 0)) * 0.25 +                      // Prefer P05 CAGR >= 3%
      Math.max(0, (input.minTrades ?? 10) - trades) * 0.01;           // Small penalty for low trades

    cand.score = Math.round(score * 10000) / 10000;
    cand.flags = flags;
  }

  /**
   * Run grid sweep to find optimal entropy guard parameters
   */
  async run(input: SweepInput): Promise<SweepResult> {
    const startTime = Date.now();

    // Grid values
    const warnValues = input.warn ?? [0.35, 0.40, 0.45];
    const hardValues = input.hard ?? [0.55, 0.60, 0.65];
    const minScaleValues = input.minScale ?? [0.35, 0.45, 0.55];
    const emaAlphaValues = input.emaAlpha ?? [0.15, 0.25, 0.35];

    const iterations = input.iterations ?? 3000;
    const blockSizes = input.blockSizes ?? [5, 7, 10];

    // Calculate grid size
    const totalCombinations = warnValues.length * hardValues.length * 
                               minScaleValues.length * emaAlphaValues.length;
    const gridSize = `${warnValues.length}x${hardValues.length}x${minScaleValues.length}x${emaAlphaValues.length}`;

    console.log(`[ENTROPY SWEEP 36.10.10] Starting grid search`);
    console.log(`[ENTROPY SWEEP] Grid: ${gridSize} = ${totalCombinations} combinations`);
    console.log(`[ENTROPY SWEEP] Period: ${input.from} -> ${input.to}`);
    console.log(`[ENTROPY SWEEP] MC iterations: ${iterations}`);

    const candidates: SweepCandidate[] = [];
    let processed = 0;

    // Iterate through all combinations
    for (const w of warnValues) {
      for (const h of hardValues) {
        // Skip invalid: hard must be greater than warn
        if (h <= w) continue;

        for (const ms of minScaleValues) {
          for (const a of emaAlphaValues) {
            processed++;
            
            const entropyGuardConfig: Partial<EntropyGuardConfig> = {
              enabled: true,
              warnEntropy: w,
              hardEntropy: h,
              minScale: ms,
              emaAlpha: a,
              // Keep other defaults
              alphaStrength: DEFAULT_ENTROPY_GUARD_CONFIG.alphaStrength,
              alphaConf: DEFAULT_ENTROPY_GUARD_CONFIG.alphaConf,
              dominancePenaltyEnabled: DEFAULT_ENTROPY_GUARD_CONFIG.dominancePenaltyEnabled,
              dominanceHard: DEFAULT_ENTROPY_GUARD_CONFIG.dominanceHard,
              dominancePenalty: DEFAULT_ENTROPY_GUARD_CONFIG.dominancePenalty,
              emaEnabled: true,
            };

            console.log(`[SWEEP ${processed}/${totalCombinations}] Testing: warn=${w}, hard=${h}, minScale=${ms}, ema=${a}`);

            try {
              const certifyResult = await this.certify.run({
                from: input.from,
                to: input.to,
                iterations,
                blockSizes,
                entropyGuardConfig,
              });

              const cand: SweepCandidate = {
                params: { warn: w, hard: h, minScale: ms, emaAlpha: a },
                wf: {
                  sharpe: certifyResult.wf.on.sharpe,
                  cagr: certifyResult.wf.on.cagr,
                  maxDD: certifyResult.wf.on.maxDD,
                  trades: certifyResult.wf.on.trades,
                },
                mc: {
                  p95MaxDD: certifyResult.mc.on.p95MaxDD,
                  worstSharpe: certifyResult.mc.on.worstSharpe,
                  p05CAGR: certifyResult.mc.on.p05CAGR,
                  passed: certifyResult.mc.on.passed,
                },
                score: 0,
                flags: [],
              };

              this.scoreCand(cand, input);
              candidates.push(cand);

              console.log(
                `[SWEEP] Result: P95DD=${(cand.mc.p95MaxDD*100).toFixed(1)}%, ` +
                `Sharpe=${cand.wf.sharpe.toFixed(3)}, Score=${cand.score.toFixed(4)}`
              );

            } catch (err) {
              console.error(`[SWEEP] Error for params:`, { w, h, ms, a }, err);
              // Skip failed combinations
            }
          }
        }
      }
    }

    // Sort by score (lower is better)
    candidates.sort((a, b) => a.score - b.score);

    const top = candidates.slice(0, 10);
    const best = top[0] ?? null;

    const executionTimeMs = Date.now() - startTime;

    // Generate recommendation
    let recommendation: string;
    if (best && best.mc.p95MaxDD <= 0.35 && best.wf.sharpe >= 0.5) {
      recommendation = `✅ OPTIMAL FOUND: warn=${best.params.warn}, hard=${best.params.hard}, ` +
                       `minScale=${best.params.minScale}, emaAlpha=${best.params.emaAlpha}`;
    } else if (best && best.mc.p95MaxDD <= 0.40) {
      recommendation = `🟡 ACCEPTABLE: Best P95DD=${(best.mc.p95MaxDD*100).toFixed(1)}% - consider wider grid`;
    } else {
      recommendation = `🔴 NO GOOD CANDIDATES: Best P95DD=${best ? (best.mc.p95MaxDD*100).toFixed(1) : 'N/A'}% exceeds target`;
    }

    console.log(`[ENTROPY SWEEP 36.10.10] Complete in ${(executionTimeMs/1000/60).toFixed(1)} min`);
    console.log(`[ENTROPY SWEEP] Tested: ${candidates.length} valid combinations`);
    console.log(`[ENTROPY SWEEP] ${recommendation}`);

    return {
      ok: true,
      count: candidates.length,
      gridSize,
      best,
      top,
      executionTimeMs,
      recommendation,
    };
  }
}

// Export singleton
export const simEntropySweepService = new SimEntropySweepService();
