/**
 * BLOCK 29.15: Walk-Forward Trading Evaluation Service
 * Runs real backtest on rolling windows for stability analysis
 */

import { FractalBacktestService, BacktestConfig, BacktestResult } from '../backtest/fractal.backtest.service.js';

const DAY_MS = 86400000;

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
  const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

export interface WFTradingEvalParams {
  symbol: string;
  mlVersion: string;
  evalStart: Date;
  evalEnd: Date;
  windowDays: number;
  stepDays: number;
  purgeDays?: number;
  backtestConfig?: Partial<BacktestConfig>;
}

export interface WFTradingRun {
  fromTs: Date;
  toTs: Date;
  trades: number;
  sharpe: number;
  maxDD: number;
  hitRate: number;
  cagr: number;
  avgLeverage?: number;
  avgVolAnn?: number;
}

export interface WFTradingResult {
  evalStart: Date;
  evalEnd: Date;
  windowDays: number;
  stepDays: number;
  purgeDays: number;
  windows: number;

  median_sharpe: number;
  std_sharpe: number;
  positive_window_frac: number;
  stability_score: number;

  median_maxDD: number;
  median_hitRate: number;

  runs: WFTradingRun[];
}

export class FractalWFTradingEvalService {
  private backtest = new FractalBacktestService();

  async evaluate(params: WFTradingEvalParams): Promise<WFTradingResult> {
    const {
      symbol,
      mlVersion,
      evalStart,
      evalEnd,
      windowDays,
      stepDays,
      purgeDays = 30,
      backtestConfig = {}
    } = params;

    const runs: WFTradingRun[] = [];

    // Use purged stepping: next window starts after window + purge gap
    const effectiveStep = Math.max(stepDays, windowDays + purgeDays);

    for (
      let fromTime = evalStart.getTime();
      fromTime + windowDays * DAY_MS <= evalEnd.getTime();
      fromTime += effectiveStep * DAY_MS
    ) {
      const fromTs = new Date(fromTime);
      const toTs = new Date(fromTime + windowDays * DAY_MS);

      try {
        const result = await this.backtest.run({
          symbol,
          windowLen: backtestConfig.windowLen ?? 60,
          horizonDays: backtestConfig.horizonDays ?? 30,
          topK: backtestConfig.topK ?? 25,
          minGapDays: backtestConfig.minGapDays ?? 60,
          startDate: fromTs,
          endDate: toTs,
          mlVersion
        });

        runs.push({
          fromTs,
          toTs,
          trades: result.totalTrades,
          sharpe: result.sharpe,
          maxDD: result.maxDD,
          hitRate: result.winRate,
          cagr: result.cagr
        });
      } catch (err) {
        console.error(`[WFTradingEval] Window ${fromTs.toISOString()} failed:`, err);
        // Continue with other windows
      }
    }

    if (runs.length === 0) {
      return {
        evalStart,
        evalEnd,
        windowDays,
        stepDays,
        purgeDays,
        windows: 0,
        median_sharpe: 0,
        std_sharpe: 0,
        positive_window_frac: 0,
        stability_score: 0,
        median_maxDD: 0,
        median_hitRate: 0,
        runs: []
      };
    }

    // Calculate aggregate metrics
    const sharpes = runs.map(r => r.sharpe);
    const posFrac = sharpes.filter(s => s > 0).length / sharpes.length;
    const medSharpe = median(sharpes);
    const stdSharpe = std(sharpes);

    // Stability score: high median + many positive windows - low variance
    const stability = medSharpe * posFrac - 0.25 * stdSharpe;

    const medMaxDD = median(runs.map(r => r.maxDD));
    const medHitRate = median(runs.map(r => r.hitRate));

    return {
      evalStart,
      evalEnd,
      windowDays,
      stepDays,
      purgeDays,
      windows: runs.length,

      median_sharpe: medSharpe,
      std_sharpe: stdSharpe,
      positive_window_frac: posFrac,
      stability_score: stability,

      median_maxDD: medMaxDD,
      median_hitRate: medHitRate,

      runs
    };
  }
}
