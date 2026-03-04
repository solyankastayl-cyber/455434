/**
 * BLOCK 34.4: Confidence Gate Sweep Service
 * Grid search over gating parameters
 */

import { FractalSimulationRunner, SimConfig } from './sim.runner.js';
import { GateConfig, formatGateConfig } from './sim.confidence-gate.js';

export interface GateSweepRow {
  minEnter: number;
  minFull: number;
  minFlip: number;
  softGate: boolean;
  sharpe: number;
  maxDD: number;
  cagr: number;
  trades: number;
  gateBlockEnter: number;
  gateBlockFlip: number;
  avgConfScale: number;
  avgPosSize: number;
  softKills: number;
  hardKills: number;
  score: number;
  finalEquity: number;
}

export interface GateSweepResult {
  ok: boolean;
  symbol: string;
  from: string;
  to: string;
  grid: {
    enter: number[];
    full: number[];
    flip: number[];
  };
  runs: number;
  duration: number;
  top10: GateSweepRow[];
  rows: GateSweepRow[];
  bestConfig: {
    minEnter: number;
    minFull: number;
    minFlip: number;
    sharpe: number;
    maxDD: number;
    trades: number;
    score: number;
  } | null;
  baselineComparison: {
    baseline: { sharpe: number; maxDD: number; trades: number };
    best: { sharpe: number; maxDD: number; trades: number };
    improvement: { sharpe: string; maxDD: string; trades: string };
  } | null;
}

export class GateSweepService {
  private sim: FractalSimulationRunner;

  constructor() {
    this.sim = new FractalSimulationRunner();
  }

  /**
   * Run gate parameter sweep
   */
  async gateSweep(params: {
    symbol: string;
    from: string;
    to: string;
    enter: number[];
    full: number[];
    flip: number[];
    softGate?: boolean;
    maxRuns?: number;
    mode?: 'AUTOPILOT' | 'FROZEN';
  }): Promise<GateSweepResult> {
    const startTime = Date.now();
    const maxRuns = params.maxRuns ?? 50;
    const softGate = params.softGate ?? true;

    const rows: GateSweepRow[] = [];
    let runs = 0;

    // Run baseline first (no gating)
    console.log('[GateSweep] Running baseline (no gating)...');
    const baselineResult = await this.sim.run({
      symbol: params.symbol,
      from: params.from,
      to: params.to,
      stepDays: 7,
      mode: params.mode ?? 'AUTOPILOT',
      experiment: 'E0',
      gateConfig: { enabled: false } as any
    });

    const baseline = {
      sharpe: this.round(baselineResult.summary.sharpe, 4),
      maxDD: this.round(baselineResult.summary.maxDD, 4),
      trades: baselineResult.summary.tradesOpened
    };

    console.log(`[GateSweep] Baseline: Sharpe=${baseline.sharpe} MaxDD=${baseline.maxDD} Trades=${baseline.trades}`);

    // Grid sweep
    console.log(`[GateSweep] Starting grid: ${params.enter.length}×${params.full.length}×${params.flip.length} = ${params.enter.length * params.full.length * params.flip.length} combinations`);

    for (const minEnter of params.enter) {
      for (const minFull of params.full) {
        // Sanity: minFull should be > minEnter
        if (minFull <= minEnter) continue;

        for (const minFlip of params.flip) {
          // Sanity: minFlip should be >= minEnter
          if (minFlip < minEnter) continue;

          if (runs >= maxRuns) break;

          const gateConfig: GateConfig = {
            enabled: true,
            minEnterConfidence: minEnter,
            minFullSizeConfidence: minFull,
            minFlipConfidence: minFlip,
            softGate
          };

          console.log(`[GateSweep] Run ${runs + 1}/${maxRuns}: ${formatGateConfig(gateConfig)}`);

          try {
            const result = await this.sim.run({
              symbol: params.symbol,
              from: params.from,
              to: params.to,
              stepDays: 7,
              mode: params.mode ?? 'AUTOPILOT',
              experiment: 'E0',
              gateConfig
            });

            // Extract gate telemetry
            const events = result.events || [];
            const gateBlockEnter = events.filter(e => e.type === 'GATE_BLOCK_ENTER').length;
            const gateBlockFlip = events.filter(e => e.type === 'GATE_BLOCK_FLIP').length;
            const confScaleEvents = events.filter(e => e.type === 'CONF_SCALE');
            const avgConfScale = confScaleEvents.length > 0
              ? confScaleEvents.reduce((a, e) => a + (e.meta?.scale ?? 1), 0) / confScaleEvents.length
              : 1;

            // Composite score
            const trades = result.summary.tradesOpened;
            const sharpe = result.summary.sharpe;
            const maxDD = result.summary.maxDD;
            const softKills = result.telemetry?.softKills ?? 0;

            // Score = sharpe - 0.5*maxDD - 0.1*(softKills/trades)
            const softKillPenalty = trades > 0 ? 0.1 * (softKills / trades) : 0;
            const score = sharpe - 0.5 * maxDD - softKillPenalty;

            rows.push({
              minEnter,
              minFull,
              minFlip,
              softGate,
              sharpe: this.round(sharpe, 4),
              maxDD: this.round(maxDD, 4),
              cagr: this.round(result.summary.cagr, 4),
              trades,
              gateBlockEnter,
              gateBlockFlip,
              avgConfScale: this.round(avgConfScale, 3),
              avgPosSize: this.round(result.summary.turnover / Math.max(1, trades), 3),
              softKills,
              hardKills: result.telemetry?.hardKills ?? 0,
              score: this.round(score, 4),
              finalEquity: this.round(result.summary.finalEquity, 4)
            });

            runs++;
          } catch (err) {
            console.error(`[GateSweep] Error:`, err);
          }
        }
        if (runs >= maxRuns) break;
      }
      if (runs >= maxRuns) break;
    }

    // Sort by: 1) trades >= 10, 2) maxDD < 0.30, 3) score desc
    rows.sort((a, b) => {
      const aValid = a.trades >= 10 && a.maxDD < 0.30 ? 0 : 1;
      const bValid = b.trades >= 10 && b.maxDD < 0.30 ? 0 : 1;
      if (aValid !== bValid) return aValid - bValid;
      return b.score - a.score;
    });

    // Best config
    const bestRow = rows.find(r => r.trades >= 10 && r.maxDD < 0.30) || rows[0];
    const bestConfig = bestRow ? {
      minEnter: bestRow.minEnter,
      minFull: bestRow.minFull,
      minFlip: bestRow.minFlip,
      sharpe: bestRow.sharpe,
      maxDD: bestRow.maxDD,
      trades: bestRow.trades,
      score: bestRow.score
    } : null;

    // Comparison
    const baselineComparison = bestConfig ? {
      baseline,
      best: {
        sharpe: bestConfig.sharpe,
        maxDD: bestConfig.maxDD,
        trades: bestConfig.trades
      },
      improvement: {
        sharpe: `${((bestConfig.sharpe - baseline.sharpe) * 100).toFixed(1)}%`,
        maxDD: `${((baseline.maxDD - bestConfig.maxDD) * 100).toFixed(1)}pp`,
        trades: `${bestConfig.trades - baseline.trades}`
      }
    } : null;

    const duration = Date.now() - startTime;
    console.log(`[GateSweep] Completed ${runs} runs in ${(duration / 1000).toFixed(1)}s`);

    return {
      ok: true,
      symbol: params.symbol,
      from: params.from,
      to: params.to,
      grid: {
        enter: params.enter,
        full: params.full,
        flip: params.flip
      },
      runs: rows.length,
      duration,
      top10: rows.slice(0, 10),
      rows,
      bestConfig,
      baselineComparison
    };
  }

  /**
   * Quick gate sweep with default grid
   */
  async quickGateSweep(params: {
    symbol?: string;
    from?: string;
    to?: string;
  }): Promise<GateSweepResult> {
    const now = new Date();
    const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 86400000);

    return this.gateSweep({
      symbol: params.symbol ?? 'BTC',
      from: params.from ?? fiveYearsAgo.toISOString().slice(0, 10),
      to: params.to ?? now.toISOString().slice(0, 10),
      enter: [0.25, 0.30, 0.35],
      full: [0.60, 0.65, 0.70],
      flip: [0.45, 0.55],
      softGate: true,
      maxRuns: 20
    });
  }

  private round(n: number, d: number): number {
    const f = Math.pow(10, d);
    return Math.round(n * f) / f;
  }
}
