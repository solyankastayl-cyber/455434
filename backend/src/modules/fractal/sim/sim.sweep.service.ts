/**
 * BLOCK 34.2 + 34.5: Risk Surface Sweep Service
 * Automated grid search over risk parameters
 * + Gate × Risk Combo Sweep support
 */

import { FractalSimulationRunner, SimConfig, SimResult } from './sim.runner.js';
import { SimOverrides, formatOverrides } from './sim.overrides.js';
import { GateConfig } from './sim.confidence-gate.js';

export interface SweepRow {
  soft: number;
  hard: number;
  taper: number;
  sharpe: number;
  cagr: number;
  maxDD: number;
  trades: number;
  costs: number;
  rollbacks: number;
  retrains: number;
  horizonChanges: number;
  hardKills: number;
  softKills: number;
  finalEquity: number;
  ddPeriod: string;
  // BLOCK 34.5: Gate telemetry
  gateBlockEnter?: number;
  avgConfScale?: number;
}

export interface SweepResult {
  ok: boolean;
  symbol: string;
  from: string;
  to: string;
  gateConfig?: GateConfig;
  actualGrid: {
    soft: number[];
    hard: number[];
    taper: number[];
  };
  runs: number;
  duration: number;
  top10: SweepRow[];
  rows: SweepRow[];
  heatmap: {
    soft: number[];
    hard: number[];
    sharpe: number[][];
    maxDD: number[][];
  };
  bestConfig: {
    soft: number;
    hard: number;
    taper: number;
    sharpe: number;
    maxDD: number;
    trades?: number;
  } | null;
}

/**
 * Clamp grid to maxRuns
 */
function clampRuns(
  soft: number[],
  hard: number[],
  taper: number[],
  maxRuns: number
): { soft: number[]; hard: number[]; taper: number[] } {
  const total = soft.length * hard.length * taper.length;
  if (total <= maxRuns) return { soft, hard, taper };

  // Simple downsample - pick evenly spaced values
  const pick = (arr: number[], k: number): number[] => {
    if (arr.length <= k) return arr;
    const out: number[] = [];
    const step = (arr.length - 1) / (k - 1);
    for (let i = 0; i < k; i++) {
      out.push(arr[Math.round(i * step)]);
    }
    return [...new Set(out)];
  };

  // Calculate how many of each dimension we can afford
  const k = Math.max(2, Math.floor(Math.cbrt(maxRuns)));
  return {
    soft: pick(soft, k),
    hard: pick(hard, k + 1), // slightly more hard values
    taper: pick(taper, Math.max(2, Math.floor(k / 2)))
  };
}

export class SimSweepService {
  private sim: FractalSimulationRunner;

  constructor() {
    this.sim = new FractalSimulationRunner();
  }

  /**
   * BLOCK 34.5: Run Gate × Risk Combo Sweep
   * Fixed gate config + variable risk parameters
   */
  async gateRiskSweep(params: {
    symbol: string;
    from: string;
    to: string;
    gateConfig: GateConfig;
    soft: number[];
    hard: number[];
    taper: number[];
    maxRuns?: number;
    mode?: 'AUTOPILOT' | 'FROZEN';
  }): Promise<SweepResult> {
    const startTime = Date.now();
    const maxRuns = params.maxRuns ?? 30;
    const grids = clampRuns(params.soft, params.hard, params.taper, maxRuns);

    const rows: SweepRow[] = [];
    let runs = 0;

    console.log(`[GateRiskSweep] Gate: enter=${params.gateConfig.minEnterConfidence} full=${params.gateConfig.minFullSizeConfidence} flip=${params.gateConfig.minFlipConfidence}`);
    console.log(`[GateRiskSweep] Risk grid: ${grids.soft.length}×${grids.hard.length}×${grids.taper.length} = ${grids.soft.length * grids.hard.length * grids.taper.length} combinations`);

    for (const soft of grids.soft) {
      for (const hard of grids.hard) {
        if (hard <= soft) continue;

        for (const taper of grids.taper) {
          if (runs >= maxRuns) break;

          const overrides: SimOverrides = {
            dd: { soft, hard },
            risk: { taper }
          };

          console.log(`[GateRiskSweep] Run ${runs + 1}/${maxRuns}: soft=${(soft*100).toFixed(0)}% hard=${(hard*100).toFixed(0)}% taper=${taper}`);

          try {
            const res = await this.sim.run({
              symbol: params.symbol,
              from: params.from,
              to: params.to,
              stepDays: 7,
              mode: params.mode ?? 'AUTOPILOT',
              experiment: 'E0',
              overrides,
              gateConfig: params.gateConfig
            });

            // Extract gate telemetry
            const events = res.events || [];
            const gateBlockEnter = events.filter(e => e.type === 'GATE_BLOCK_ENTER').length;
            const confScaleEvents = events.filter(e => e.type === 'CONF_SCALE');
            const avgConfScale = confScaleEvents.length > 0
              ? confScaleEvents.reduce((a, e) => a + (e.meta?.scale ?? 1), 0) / confScaleEvents.length
              : 1;

            const row: SweepRow = {
              soft,
              hard,
              taper,
              sharpe: this.round(res.summary.sharpe, 4),
              cagr: this.round(res.summary.cagr, 4),
              maxDD: this.round(res.summary.maxDD, 4),
              trades: res.summary.tradesOpened,
              costs: this.round(res.summary.totalCosts, 6),
              rollbacks: res.summary.rollbackCount,
              retrains: res.summary.retrainCount,
              horizonChanges: res.telemetry?.horizonChanges ?? 0,
              hardKills: res.telemetry?.hardKills ?? 0,
              softKills: res.telemetry?.softKills ?? 0,
              finalEquity: this.round(res.summary.finalEquity, 4),
              ddPeriod: res.ddAttribution?.maxDDPeriod?.start
                ? `${res.ddAttribution.maxDDPeriod.start} → ${res.ddAttribution.maxDDPeriod.end}`
                : '',
              gateBlockEnter,
              avgConfScale: this.round(avgConfScale, 3)
            };

            rows.push(row);
            runs++;
          } catch (err) {
            console.error(`[GateRiskSweep] Error at soft=${soft} hard=${hard} taper=${taper}:`, err);
          }
        }
        if (runs >= maxRuns) break;
      }
      if (runs >= maxRuns) break;
    }

    // Filter & Sort: trades >= 20, DD <= 30%, rollbacks < 15, then by Sharpe desc
    rows.sort((a, b) => {
      const aValid = a.trades >= 20 && a.maxDD <= 0.30 && a.rollbacks < 15 ? 0 : 1;
      const bValid = b.trades >= 20 && b.maxDD <= 0.30 && b.rollbacks < 15 ? 0 : 1;
      if (aValid !== bValid) return aValid - bValid;
      return b.sharpe - a.sharpe;
    });

    const heatmap = this.buildHeatmap(rows, grids.soft, grids.hard);

    // Best config (meets all criteria)
    const bestRow = rows.find(r => r.trades >= 20 && r.maxDD <= 0.30 && r.rollbacks < 15) || rows[0];
    const bestConfig = bestRow ? {
      soft: bestRow.soft,
      hard: bestRow.hard,
      taper: bestRow.taper,
      sharpe: bestRow.sharpe,
      maxDD: bestRow.maxDD,
      trades: bestRow.trades
    } : null;

    const duration = Date.now() - startTime;
    console.log(`[GateRiskSweep] Completed ${runs} runs in ${(duration / 1000).toFixed(1)}s`);

    return {
      ok: true,
      symbol: params.symbol,
      from: params.from,
      to: params.to,
      gateConfig: params.gateConfig,
      actualGrid: grids,
      runs: rows.length,
      duration,
      top10: rows.slice(0, 10),
      rows,
      heatmap,
      bestConfig
    };
  }

  /**
   * Run risk surface sweep (original, without gate)
   */
  async riskSweep(params: {
    symbol: string;
    from: string;
    to: string;
    soft: number[];
    hard: number[];
    taper: number[];
    maxRuns?: number;
    mode?: 'AUTOPILOT' | 'FROZEN';
    stepDays?: number;
    gateConfig?: GateConfig;  // BLOCK 34.5: Optional gate config
  }): Promise<SweepResult> {
    const startTime = Date.now();
    const maxRuns = params.maxRuns ?? 120;
    const grids = clampRuns(params.soft, params.hard, params.taper, maxRuns);

    const rows: SweepRow[] = [];
    let runs = 0;

    console.log(`[Sweep] Starting risk sweep: ${grids.soft.length}×${grids.hard.length}×${grids.taper.length} = ${grids.soft.length * grids.hard.length * grids.taper.length} combinations`);

    for (const soft of grids.soft) {
      for (const hard of grids.hard) {
        // Sanity: hard must be > soft
        if (hard <= soft) continue;

        for (const taper of grids.taper) {
          if (runs >= maxRuns) break;

          const overrides: SimOverrides = {
            dd: { soft, hard },
            risk: { taper }
          };

          console.log(`[Sweep] Run ${runs + 1}/${maxRuns}: ${formatOverrides(overrides)}`);

          try {
            const res = await this.sim.run({
              symbol: params.symbol,
              from: params.from,
              to: params.to,
              stepDays: params.stepDays ?? 7,
              mode: params.mode ?? 'AUTOPILOT',
              experiment: 'E0',
              overrides,
              gateConfig: params.gateConfig  // BLOCK 34.5
            });

            // Extract gate telemetry if gateConfig provided
            let gateBlockEnter = 0;
            let avgConfScale = 1;
            if (params.gateConfig) {
              const events = res.events || [];
              gateBlockEnter = events.filter(e => e.type === 'GATE_BLOCK_ENTER').length;
              const confScaleEvents = events.filter(e => e.type === 'CONF_SCALE');
              avgConfScale = confScaleEvents.length > 0
                ? confScaleEvents.reduce((a, e) => a + (e.meta?.scale ?? 1), 0) / confScaleEvents.length
                : 1;
            }

            const row: SweepRow = {
              soft,
              hard,
              taper,
              sharpe: this.round(res.summary.sharpe, 4),
              cagr: this.round(res.summary.cagr, 4),
              maxDD: this.round(res.summary.maxDD, 4),
              trades: res.summary.tradesOpened,
              costs: this.round(res.summary.totalCosts, 6),
              rollbacks: res.summary.rollbackCount,
              retrains: res.summary.retrainCount,
              horizonChanges: res.telemetry?.horizonChanges ?? 0,
              hardKills: res.telemetry?.hardKills ?? 0,
              softKills: res.telemetry?.softKills ?? 0,
              finalEquity: this.round(res.summary.finalEquity, 4),
              ddPeriod: res.ddAttribution?.maxDDPeriod?.start
                ? `${res.ddAttribution.maxDDPeriod.start} → ${res.ddAttribution.maxDDPeriod.end}`
                : '',
              gateBlockEnter: params.gateConfig ? gateBlockEnter : undefined,
              avgConfScale: params.gateConfig ? this.round(avgConfScale, 3) : undefined
            };

            rows.push(row);
            runs++;
          } catch (err) {
            console.error(`[Sweep] Error at soft=${soft} hard=${hard} taper=${taper}:`, err);
          }
        }
        if (runs >= maxRuns) break;
      }
      if (runs >= maxRuns) break;
    }

    // Sort by: 1) DD constraint (<=25%), 2) sharpe desc, 3) cagr desc
    rows.sort((a, b) => {
      const aBad = a.maxDD > 0.25 ? 1 : 0;
      const bBad = b.maxDD > 0.25 ? 1 : 0;
      if (aBad !== bBad) return aBad - bBad;
      if (b.sharpe !== a.sharpe) return b.sharpe - a.sharpe;
      return b.cagr - a.cagr;
    });

    // Build heatmap (2D: soft × hard, averaged over taper)
    const heatmap = this.buildHeatmap(rows, grids.soft, grids.hard);

    // Find best config (DD <= 20%, max sharpe)
    const bestRow = rows.find(r => r.maxDD <= 0.20) || rows[0];
    const bestConfig = bestRow ? {
      soft: bestRow.soft,
      hard: bestRow.hard,
      taper: bestRow.taper,
      sharpe: bestRow.sharpe,
      maxDD: bestRow.maxDD,
      trades: bestRow.trades
    } : null;

    const duration = Date.now() - startTime;
    console.log(`[Sweep] Completed ${runs} runs in ${(duration / 1000).toFixed(1)}s`);

    return {
      ok: true,
      symbol: params.symbol,
      from: params.from,
      to: params.to,
      actualGrid: grids,
      runs: rows.length,
      duration,
      top10: rows.slice(0, 10),
      rows,
      heatmap,
      bestConfig
    };
  }

  /**
   * Quick sweep with common ranges
   */
  async quickSweep(params: {
    symbol?: string;
    from?: string;
    to?: string;
    mode?: 'AUTOPILOT' | 'FROZEN';
  }): Promise<SweepResult> {
    const now = new Date();
    const fiveYearsAgo = new Date(now.getTime() - 5 * 365 * 86400000);

    return this.riskSweep({
      symbol: params.symbol ?? 'BTC',
      from: params.from ?? fiveYearsAgo.toISOString().slice(0, 10),
      to: params.to ?? now.toISOString().slice(0, 10),
      soft: [0.06, 0.08, 0.10, 0.12],
      hard: [0.15, 0.18, 0.20, 0.22, 0.25],
      taper: [0.7, 0.85, 1.0],
      maxRuns: 60,
      mode: params.mode ?? 'AUTOPILOT',
      stepDays: 7
    });
  }

  /**
   * Full sweep with fine grid
   */
  async fullSweep(params: {
    symbol?: string;
    from?: string;
    to?: string;
  }): Promise<SweepResult> {
    return this.riskSweep({
      symbol: params.symbol ?? 'BTC',
      from: params.from ?? '2017-01-01',
      to: params.to ?? new Date().toISOString().slice(0, 10),
      soft: [0.05, 0.06, 0.07, 0.08, 0.09, 0.10, 0.11, 0.12],
      hard: [0.14, 0.16, 0.18, 0.20, 0.22, 0.24, 0.26],
      taper: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      maxRuns: 200,
      mode: 'AUTOPILOT',
      stepDays: 7
    });
  }

  /**
   * Build 2D heatmap from sweep results
   */
  private buildHeatmap(
    rows: SweepRow[],
    softVals: number[],
    hardVals: number[]
  ): { soft: number[]; hard: number[]; sharpe: number[][]; maxDD: number[][] } {
    const sharpeMap: number[][] = [];
    const ddMap: number[][] = [];

    for (let i = 0; i < softVals.length; i++) {
      const sharpeRow: number[] = [];
      const ddRow: number[] = [];

      for (let j = 0; j < hardVals.length; j++) {
        const soft = softVals[i];
        const hard = hardVals[j];

        // Find all rows matching this soft/hard (average over taper)
        const matching = rows.filter(r => r.soft === soft && r.hard === hard);

        if (matching.length > 0) {
          const avgSharpe = matching.reduce((s, r) => s + r.sharpe, 0) / matching.length;
          const avgDD = matching.reduce((s, r) => s + r.maxDD, 0) / matching.length;
          sharpeRow.push(this.round(avgSharpe, 3));
          ddRow.push(this.round(avgDD, 3));
        } else {
          sharpeRow.push(NaN);
          ddRow.push(NaN);
        }
      }

      sharpeMap.push(sharpeRow);
      ddMap.push(ddRow);
    }

    return {
      soft: softVals,
      hard: hardVals,
      sharpe: sharpeMap,
      maxDD: ddMap
    };
  }

  private round(n: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  }
}
