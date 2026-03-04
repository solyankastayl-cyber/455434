/**
 * BLOCK 36.10.8 — Multi-Horizon Certify Service (A/B Testing)
 * 
 * Compares strategy performance with and without Entropy Guard.
 * Runs Walk-Forward + Monte Carlo for both configurations.
 * 
 * This allows us to measure the actual impact of Entropy Guard
 * on tail risk (P95 MaxDD) without affecting daily Sharpe.
 */

import { SimMultiHorizonService } from './sim.multi-horizon.service.js';
import { runMonteCarloV2, MonteCarloV2Result } from './sim.montecarlo-v2.service.js';
import { DEFAULT_MULTI_HORIZON_CONFIG, MultiHorizonConfig } from '../engine/multi-horizon.engine.js';
import { EntropyGuardConfig, DEFAULT_ENTROPY_GUARD_CONFIG } from '../engine/v2/entropy.guard.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface CertifyInput {
  from: string;            // "2019-01-01"
  to: string;              // "2026-02-15"
  iterations?: number;     // default 3000
  blockSizes?: number[];   // default [5, 7, 10]
  presetKey?: string;      // if using presets
  horizonConfig?: Partial<MultiHorizonConfig>;
  entropyGuardConfig?: Partial<EntropyGuardConfig>;
}

export interface CertifyWFSummary {
  sharpe: number;
  cagr: number;
  maxDD: number;
  trades: number;
  winRate: number;
  finalEquity: number;
}

export interface CertifyMCSummary {
  p95MaxDD: number;
  worstMaxDD: number;
  worstSharpe: number;
  p05CAGR: number;
  medianSharpe: number;
  passed: boolean;
}

export interface CertifyResult {
  ok: boolean;
  wf: {
    off: CertifyWFSummary;
    on: CertifyWFSummary;
  };
  mc: {
    off: CertifyMCSummary;
    on: CertifyMCSummary;
  };
  delta: {
    p95MaxDD: number | null;      // positive = improvement (lower DD with guard ON)
    sharpe: number | null;        // negative = cost (lower sharpe with guard ON)
    cagr: number | null;
  };
  recommendation: string;
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════

export class SimMultiHorizonCertifyService {
  private sim: SimMultiHorizonService;

  constructor() {
    this.sim = new SimMultiHorizonService();
  }

  /**
   * Clone config deeply to avoid mutations
   */
  private cloneCfg<T>(cfg: T): T {
    return JSON.parse(JSON.stringify(cfg));
  }

  /**
   * Create config with entropy guard enabled/disabled
   */
  private withEntropy(
    horizonCfg: MultiHorizonConfig,
    entropyBase: EntropyGuardConfig,
    enabled: boolean
  ): { horizon: MultiHorizonConfig; entropy: EntropyGuardConfig } {
    const horizon = this.cloneCfg(horizonCfg);
    const entropy = this.cloneCfg(entropyBase);
    entropy.enabled = enabled;
    return { horizon, entropy };
  }

  /**
   * Extract WF summary from simulation result
   */
  private extractWFSummary(result: any): CertifyWFSummary {
    return {
      sharpe: result.metrics?.sharpe ?? 0,
      cagr: result.metrics?.cagr ?? 0,
      maxDD: result.metrics?.maxDD ?? 0,
      trades: result.metrics?.totalTrades ?? 0,
      winRate: result.metrics?.winRate ?? 0,
      finalEquity: result.metrics?.finalEquity ?? 1,
    };
  }

  /**
   * Extract MC summary from MC result
   */
  private extractMCSummary(result: MonteCarloV2Result): CertifyMCSummary {
    return {
      p95MaxDD: result.aggregated?.p95MaxDD ?? 1,
      worstMaxDD: result.aggregated?.worstMaxDD ?? 1,
      worstSharpe: result.aggregated?.worstSharpe ?? -99,
      p05CAGR: result.aggregated?.p05CAGR ?? -1,
      medianSharpe: result.aggregated?.medianSharpe ?? 0,
      passed: result.acceptance?.overallPass ?? false,
    };
  }

  /**
   * Run A/B certification: compare with and without Entropy Guard
   */
  async run(input: CertifyInput): Promise<CertifyResult> {
    const startTime = Date.now();

    const iterations = input.iterations ?? 3000;
    const blockSizes = input.blockSizes ?? [5, 7, 10];
    const from = input.from ?? '2019-01-01';
    const to = input.to ?? '2026-02-15';

    // Base configurations
    const horizonCfg: MultiHorizonConfig = {
      ...DEFAULT_MULTI_HORIZON_CONFIG,
      ...input.horizonConfig,
    };

    const entropyCfg: EntropyGuardConfig = {
      ...DEFAULT_ENTROPY_GUARD_CONFIG,
      ...input.entropyGuardConfig,
    };

    console.log(`[CERTIFY 36.10.8] Starting A/B test: ${from} -> ${to}`);
    console.log(`[CERTIFY 36.10.8] Iterations: ${iterations}, Block sizes: [${blockSizes.join(', ')}]`);

    // ─────────────────────────────────────────────────────────────
    // Run WF with Entropy Guard OFF
    // ─────────────────────────────────────────────────────────────
    const cfgOff = this.withEntropy(horizonCfg, entropyCfg, false);
    
    console.log(`[CERTIFY] Running WF with Entropy Guard OFF...`);
    const wfOff = await this.sim.runFull({
      start: from,
      end: to,
      horizonConfig: cfgOff.horizon,
      overrides: {
        entropyGuard: cfgOff.entropy,
      } as any,
    });
    const wfOffSummary = this.extractWFSummary(wfOff);

    // MC on OFF trades
    console.log(`[CERTIFY] Running MC (OFF)...`);
    const mcOff = await runMonteCarloV2({
      trades: wfOff.trades,
      iterations,
      blockSizes,
    });
    const mcOffSummary = this.extractMCSummary(mcOff);

    // ─────────────────────────────────────────────────────────────
    // Run WF with Entropy Guard ON
    // ─────────────────────────────────────────────────────────────
    const cfgOn = this.withEntropy(horizonCfg, entropyCfg, true);
    
    console.log(`[CERTIFY] Running WF with Entropy Guard ON...`);
    const wfOn = await this.sim.runFull({
      start: from,
      end: to,
      horizonConfig: cfgOn.horizon,
      overrides: {
        entropyGuard: cfgOn.entropy,
      } as any,
    });
    const wfOnSummary = this.extractWFSummary(wfOn);

    // MC on ON trades
    console.log(`[CERTIFY] Running MC (ON)...`);
    const mcOn = await runMonteCarloV2({
      trades: wfOn.trades,
      iterations,
      blockSizes,
    });
    const mcOnSummary = this.extractMCSummary(mcOn);

    // ─────────────────────────────────────────────────────────────
    // Calculate deltas
    // ─────────────────────────────────────────────────────────────
    const deltaP95 = mcOffSummary.p95MaxDD - mcOnSummary.p95MaxDD;  // positive = improvement
    const deltaSharpe = wfOnSummary.sharpe - wfOffSummary.sharpe;   // negative = cost
    const deltaCAGR = wfOnSummary.cagr - wfOffSummary.cagr;

    // Recommendation logic
    let recommendation: string;
    if (deltaP95 >= 0.05 && deltaSharpe >= -0.15) {
      recommendation = '✅ ENABLE Entropy Guard — Significant tail risk reduction with acceptable Sharpe cost';
    } else if (deltaP95 >= 0.03 && deltaSharpe >= -0.20) {
      recommendation = '🟡 CONSIDER Entropy Guard — Modest tail risk reduction, review parameters';
    } else if (deltaP95 < 0) {
      recommendation = '🔴 DO NOT ENABLE — Entropy Guard increases tail risk (unexpected, investigate)';
    } else {
      recommendation = '⚪ NEUTRAL — Marginal benefit, decide based on risk tolerance';
    }

    const executionTimeMs = Date.now() - startTime;

    console.log(`[CERTIFY 36.10.8] Complete in ${(executionTimeMs/1000).toFixed(1)}s`);
    console.log(`[CERTIFY 36.10.8] Delta P95 MaxDD: ${(deltaP95*100).toFixed(2)}pp`);
    console.log(`[CERTIFY 36.10.8] Delta Sharpe: ${deltaSharpe.toFixed(3)}`);

    return {
      ok: true,
      wf: {
        off: wfOffSummary,
        on: wfOnSummary,
      },
      mc: {
        off: mcOffSummary,
        on: mcOnSummary,
      },
      delta: {
        p95MaxDD: Math.round(deltaP95 * 10000) / 10000,
        sharpe: Math.round(deltaSharpe * 1000) / 1000,
        cagr: Math.round(deltaCAGR * 10000) / 10000,
      },
      recommendation,
      executionTimeMs,
    };
  }
}

// Export singleton
export const simMultiHorizonCertifyService = new SimMultiHorizonCertifyService();
