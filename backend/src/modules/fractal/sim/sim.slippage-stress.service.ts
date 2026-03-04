/**
 * BLOCK 35.4 — Slippage Stress Test Service
 * 
 * Runs multiple simulations with increasing cost multipliers
 * to verify strategy robustness under adverse conditions.
 * 
 * Key stress levels:
 * - ×1.0: Baseline (normal conditions)
 * - ×1.5: Moderate stress (high volume periods)
 * - ×2.0: Significant stress (volatile markets)
 * - ×3.0: Extreme stress (black swan resilience)
 * 
 * Pass criteria:
 * - ×2.0: Sharpe ≥ 0.50, MaxDD ≤ 40%
 * - ×3.0: Sharpe ≥ 0.35 (survival mode)
 */

import { SimFullService } from './sim.full.service.js';

export interface SlippageStressRequest {
  start?: string;
  end?: string;
  symbol?: string;
  multipliers?: number[];  // default [1, 1.5, 2, 3]
}

export interface SlippageStressResult {
  multiplier: number;
  roundTripBps: number;
  sharpe: number;
  cagr: number;
  maxDD: number;
  trades: number;
  winRate: number;
  finalEquity: number;
  verdict: string;
}

export interface SlippageStressResponse {
  ok: boolean;
  period: { start: string; end: string };
  symbol: string;
  baseCostBps: number;
  results: SlippageStressResult[];
  summary: {
    passedX2: boolean;
    passedX3: boolean;
    overallVerdict: string;
  };
}

export class SimSlippageStressService {
  private simService: SimFullService;

  constructor() {
    this.simService = new SimFullService();
  }

  /**
   * Run slippage stress test across multiple cost multipliers
   */
  async runStress(req: SlippageStressRequest = {}): Promise<SlippageStressResponse> {
    const start = req.start ?? '2014-01-01';
    const end = req.end ?? '2026-02-15';
    const symbol = req.symbol ?? 'BTC';
    const multipliers = req.multipliers ?? [1, 1.5, 2, 3];

    console.log(`[BLOCK 35.4] Starting slippage stress test: ${multipliers.join(', ')}×`);

    const baseCostBps = 24; // 2 * (4 + 6 + 2) = 24 bps round-trip
    const results: SlippageStressResult[] = [];

    for (const mult of multipliers) {
      console.log(`[BLOCK 35.4] Running with cost multiplier ×${mult}...`);
      
      const sim = await this.simService.runFull({
        start,
        end,
        symbol,
        overrides: { costMultiplier: mult },
      });

      // Determine verdict for this multiplier
      let verdict = '';
      const { sharpe, maxDD, totalTrades } = sim.metrics;
      
      if (mult === 1) {
        verdict = sharpe >= 0.55 ? '✅ Baseline OK' : '⚠️ Baseline weak';
      } else if (mult <= 1.5) {
        verdict = sharpe >= 0.50 ? '✅ Moderate stress OK' : '⚠️ Moderate stress weak';
      } else if (mult <= 2) {
        if (sharpe >= 0.50 && maxDD <= 0.40) {
          verdict = '✅ PASS — Significant stress survived';
        } else if (sharpe >= 0.40) {
          verdict = '🟡 MARGINAL — Needs monitoring';
        } else {
          verdict = '❌ FAIL — Unacceptable degradation';
        }
      } else {
        if (sharpe >= 0.35) {
          verdict = '✅ PASS — Extreme stress survived';
        } else if (sharpe > 0) {
          verdict = '🟡 SURVIVAL — Positive but degraded';
        } else {
          verdict = '❌ FAIL — Strategy breaks down';
        }
      }

      results.push({
        multiplier: mult,
        roundTripBps: Math.round(baseCostBps * mult),
        sharpe: sim.metrics.sharpe,
        cagr: sim.metrics.cagr,
        maxDD: sim.metrics.maxDD,
        trades: sim.metrics.totalTrades,
        winRate: sim.metrics.winRate,
        finalEquity: sim.metrics.finalEquity,
        verdict,
      });
    }

    // Overall assessment
    const x2Result = results.find(r => r.multiplier === 2);
    const x3Result = results.find(r => r.multiplier === 3);
    
    const passedX2 = x2Result ? (x2Result.sharpe >= 0.50 && x2Result.maxDD <= 0.40) : false;
    const passedX3 = x3Result ? (x3Result.sharpe >= 0.35) : false;

    let overallVerdict = '';
    if (passedX2 && passedX3) {
      overallVerdict = '✅ CERTIFIED STABLE — Production ready under all stress scenarios';
    } else if (passedX2) {
      overallVerdict = '🟡 CONDITIONALLY STABLE — Survives ×2, extreme conditions risky';
    } else {
      overallVerdict = '❌ NOT STABLE — Requires cost optimization or parameter tuning';
    }

    console.log(`[BLOCK 35.4] Stress test complete: ${overallVerdict}`);

    return {
      ok: true,
      period: { start, end },
      symbol,
      baseCostBps,
      results,
      summary: {
        passedX2,
        passedX3,
        overallVerdict,
      },
    };
  }
}

/**
 * Standalone runner function
 */
export async function runSlippageStress(req: SlippageStressRequest = {}): Promise<SlippageStressResponse> {
  const service = new SimSlippageStressService();
  return service.runStress(req);
}
