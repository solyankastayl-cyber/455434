/**
 * Phase H: Outcome Evaluator v2
 * 
 * Evaluates WIN/LOSS/TIMEOUT based on forward candles
 */

import { Candle } from './market_provider.js';
import { calcMfeMae } from './mfe_mae.js';
import { OutcomeRecord, OutcomeStatus } from './outcome_types.js';

export interface EvaluateParams {
  runId: string;
  asset: string;
  timeframe: string;
  scenarioId: string;
  hypothesisId: string;
  createdAt: Date;
  side: 'LONG' | 'SHORT';
  entry: number | null;
  stop: number | null;
  target1: number | null;
  candles: Candle[];
  maxBarsToEntry: number;    // e.g. 10
  maxBarsToResolve: number;  // e.g. 40
}

function reachedEntry(c: Candle, side: 'LONG' | 'SHORT', entry: number): boolean {
  return c.l <= entry && c.h >= entry;
}

function hitStop(c: Candle, side: 'LONG' | 'SHORT', stop: number): boolean {
  return side === 'LONG' ? (c.l <= stop) : (c.h >= stop);
}

function hitTarget(c: Candle, side: 'LONG' | 'SHORT', target: number): boolean {
  return side === 'LONG' ? (c.h >= target) : (c.l <= target);
}

export function evaluateOutcome(p: EvaluateParams): OutcomeRecord {
  const computedAt = new Date();

  // Basic validation
  if (!p.entry || !p.stop || !p.target1) {
    return {
      runId: p.runId,
      asset: p.asset,
      timeframe: p.timeframe,
      scenarioId: p.scenarioId,
      hypothesisId: p.hypothesisId,
      createdAt: p.createdAt,
      entry: p.entry,
      stop: p.stop,
      target1: p.target1,
      status: 'PENDING',
      hit: 'NONE',
      reason: 'missing_trade_plan_prices',
      computedAt,
    };
  }

  // Invalid side
  if (p.side !== 'LONG' && p.side !== 'SHORT') {
    return {
      runId: p.runId,
      asset: p.asset,
      timeframe: p.timeframe,
      scenarioId: p.scenarioId,
      hypothesisId: p.hypothesisId,
      createdAt: p.createdAt,
      entry: p.entry,
      stop: p.stop,
      target1: p.target1,
      status: 'NO_ENTRY',
      hit: 'NONE',
      reason: 'invalid_side',
      computedAt,
    };
  }

  // Not enough candles
  if (!p.candles.length) {
    return {
      runId: p.runId,
      asset: p.asset,
      timeframe: p.timeframe,
      scenarioId: p.scenarioId,
      hypothesisId: p.hypothesisId,
      createdAt: p.createdAt,
      entry: p.entry,
      stop: p.stop,
      target1: p.target1,
      status: 'PENDING',
      hit: 'NONE',
      reason: 'no_forward_candles',
      computedAt,
    };
  }

  // 1) Find entry fill
  let entryBar = -1;
  for (let i = 0; i < Math.min(p.candles.length, p.maxBarsToEntry); i++) {
    if (reachedEntry(p.candles[i], p.side, p.entry)) {
      entryBar = i;
      break;
    }
  }

  if (entryBar === -1) {
    return {
      runId: p.runId,
      asset: p.asset,
      timeframe: p.timeframe,
      scenarioId: p.scenarioId,
      hypothesisId: p.hypothesisId,
      createdAt: p.createdAt,
      entry: p.entry,
      stop: p.stop,
      target1: p.target1,
      status: 'NO_ENTRY',
      timeToEntryBars: null,
      hit: 'NONE',
      reason: `entry_not_reached_in_${p.maxBarsToEntry}_bars`,
      computedAt,
    };
  }

  // After entry candles
  const afterEntry = p.candles.slice(entryBar, Math.min(p.candles.length, entryBar + p.maxBarsToResolve));
  const { mfe, mae } = calcMfeMae({ candles: afterEntry, entry: p.entry, side: p.side });

  // 2) Resolve stop/target
  let status: OutcomeStatus = 'TIMEOUT';
  let hit: OutcomeRecord['hit'] = 'TIMEOUT';
  let timeToHitBars: number | null = null;

  for (let j = 0; j < afterEntry.length; j++) {
    const c = afterEntry[j];

    const sHit = hitStop(c, p.side, p.stop);
    const tHit = hitTarget(c, p.side, p.target1);

    if (sHit && tHit) {
      // Conservative: stop first
      status = 'LOSS';
      hit = 'STOP';
      timeToHitBars = j;
      break;
    }

    if (tHit) {
      status = 'WIN';
      hit = 'TARGET1';
      timeToHitBars = j;
      break;
    }

    if (sHit) {
      status = 'LOSS';
      hit = 'STOP';
      timeToHitBars = j;
      break;
    }
  }

  const mfePct = p.entry ? (mfe / p.entry) : null;
  const maePct = p.entry ? (mae / p.entry) : null;

  return {
    runId: p.runId,
    asset: p.asset,
    timeframe: p.timeframe,
    scenarioId: p.scenarioId,
    hypothesisId: p.hypothesisId,
    createdAt: p.createdAt,
    entry: p.entry,
    stop: p.stop,
    target1: p.target1,
    status,
    timeToEntryBars: entryBar,
    timeToHitBars,
    mfe,
    mae,
    mfePct,
    maePct,
    hit,
    reason: status === 'TIMEOUT' ? `no_hit_in_${p.maxBarsToResolve}_bars` : undefined,
    computedAt,
  };
}
