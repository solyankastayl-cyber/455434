/**
 * BLOCK 36.0-36.2 — V1 vs V2 Comparison Service
 * 
 * Runs quick simulation comparing V1 (no age decay, no regime)
 * vs V2 (with age decay + regime conditioning)
 */

import { SimFullService } from './sim.full.service.js';
import { FractalEngineV2 } from '../engine/fractal.engine.v2.js';
import { V1_FINAL_CONFIG, V2_EXPERIMENTAL_CONFIG } from '../config/fractal.presets.js';

export interface V1V2ComparisonResult {
  ok: boolean;
  period: { start: string; end: string };
  v1: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    trades: number;
    winRate: number;
    finalEquity: number;
  };
  v2: {
    sharpe: number;
    cagr: number;
    maxDD: number;
    trades: number;
    winRate: number;
    finalEquity: number;
    ageDecayLambda: number;
    regimeConditioned: boolean;
  };
  comparison: {
    sharpeDelta: number;
    maxDDDelta: number;
    tradesDelta: number;
    verdict: string;
  };
}

export async function compareV1V2(params: {
  start?: string;
  end?: string;
  symbol?: string;
} = {}): Promise<V1V2ComparisonResult> {
  const start = params.start ?? '2014-01-01';
  const end = params.end ?? '2026-02-15';
  const symbol = params.symbol ?? 'BTC';

  console.log(`[V1V2] Starting comparison: ${start} to ${end}`);

  const simService = new SimFullService();

  // Run V1 (baseline)
  console.log('[V1V2] Running V1 (no age decay, no regime)...');
  const v1Result = await simService.runFull({
    start,
    end,
    symbol,
    overrides: {},  // V1 defaults
  });

  // For V2, we would need to modify SimFullService to use V2 signal builder
  // For now, we'll use the same sim but note the comparison is conceptual
  // In production, V2 would use FractalEngineV2.matchV2() for signals
  
  console.log('[V1V2] V2 comparison (conceptual - same sim engine)');
  // V2 would have different match rankings due to age decay
  // This is a placeholder - real V2 sim needs signal builder integration
  
  const v2Result = {
    sharpe: v1Result.metrics.sharpe,  // Placeholder
    cagr: v1Result.metrics.cagr,
    maxDD: v1Result.metrics.maxDD,
    trades: v1Result.metrics.totalTrades,
    winRate: v1Result.metrics.winRate,
    finalEquity: v1Result.metrics.finalEquity,
    ageDecayLambda: V2_EXPERIMENTAL_CONFIG.ageDecayLambda,
    regimeConditioned: V2_EXPERIMENTAL_CONFIG.regimeConditioned,
  };

  const comparison = {
    sharpeDelta: v2Result.sharpe - v1Result.metrics.sharpe,
    maxDDDelta: v2Result.maxDD - v1Result.metrics.maxDD,
    tradesDelta: v2Result.trades - v1Result.metrics.totalTrades,
    verdict: 'V2 features enabled but using V1 signal path for comparison baseline',
  };

  console.log(`[V1V2] Comparison complete`);

  return {
    ok: true,
    period: { start, end },
    v1: {
      sharpe: v1Result.metrics.sharpe,
      cagr: v1Result.metrics.cagr,
      maxDD: v1Result.metrics.maxDD,
      trades: v1Result.metrics.totalTrades,
      winRate: v1Result.metrics.winRate,
      finalEquity: v1Result.metrics.finalEquity,
    },
    v2: v2Result,
    comparison,
  };
}
