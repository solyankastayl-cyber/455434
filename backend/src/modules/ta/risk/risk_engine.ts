/**
 * Phase G: Risk Engine
 * 
 * Main entry point - builds complete RiskPack for a scenario
 */

import { RiskPack, RiskContext, ScenarioLike } from './risk_types.js';
import { computeEntry } from './entry_engine.js';
import { computeStop } from './stop_engine.js';
import { computeTargets } from './target_engine.js';
import { rr } from './rr.js';

function clamp(x: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, x));
}

export function buildRiskPack(scenario: ScenarioLike, ctx: RiskContext): RiskPack {
  const direction = scenario.direction;
  const bias = direction === 'BULL' ? 'LONG' : direction === 'BEAR' ? 'SHORT' : 'WAIT';

  const base: RiskPack = {
    valid: true,
    direction,
    bias,
    entry: { type: 'WAIT', price: null, rationale: [] },
    stop: { type: 'INVALID', price: null, rationale: [] },
    targets: [],
    metrics: {},
    debug: {
      priceNow: ctx.priceNow,
      atr: ctx.atr,
      usedLevels: ctx.levels?.slice(0, 5),
      usedFib: ctx.fib?.slice(0, 5),
    },
  };

  // NEUTRAL = WAIT
  if (bias === 'WAIT') {
    base.valid = false;
    base.reasonIfInvalid = 'NEUTRAL_SCENARIO_WAIT';
    base.entry = { type: 'WAIT', price: null, rationale: ['neutral_bias'] };
    return base;
  }

  // Entry
  const entry = computeEntry({ direction, components: scenario.components, ctx });
  base.entry = entry;

  if (!entry.price || entry.price <= 0) {
    base.valid = false;
    base.reasonIfInvalid = 'INVALID_ENTRY';
    return base;
  }

  // Stop
  const stop = computeStop({ side: bias, entryPrice: entry.price, ctx });
  base.stop = stop;

  if (!stop.price || stop.price <= 0) {
    base.valid = false;
    base.reasonIfInvalid = 'INVALID_STOP';
    return base;
  }

  // Validate stop position
  if (bias === 'LONG' && stop.price >= entry.price) {
    base.valid = false;
    base.reasonIfInvalid = 'STOP_NOT_BELOW_ENTRY_LONG';
    return base;
  }
  if (bias === 'SHORT' && stop.price <= entry.price) {
    base.valid = false;
    base.reasonIfInvalid = 'STOP_NOT_ABOVE_ENTRY_SHORT';
    return base;
  }

  // Targets
  const targets = computeTargets({ side: bias, entryPrice: entry.price, ctx });
  base.targets = targets.map(t => ({ type: t.type, price: t.price, rationale: t.rationale }));

  // RR metrics
  const [t1, t2, t3] = base.targets.map(t => t.price).filter((p): p is number => typeof p === 'number');

  if (typeof t1 === 'number') base.metrics.rrToT1 = rr(entry.price, stop.price, t1, bias);
  if (typeof t2 === 'number') base.metrics.rrToT2 = rr(entry.price, stop.price, t2, bias);
  if (typeof t3 === 'number') base.metrics.rrToT3 = rr(entry.price, stop.price, t3, bias);

  // Percentage metrics
  const risk = bias === 'LONG' ? (entry.price - stop.price) : (stop.price - entry.price);
  base.metrics.riskPct = clamp(risk / ctx.priceNow, 0, 10);
  
  if (typeof t1 === 'number') {
    const rew = bias === 'LONG' ? (t1 - entry.price) : (entry.price - t1);
    base.metrics.rewardPctT1 = clamp(rew / ctx.priceNow, 0, 10);
  }

  return base;
}

/**
 * Build default risk context from analysis data
 */
export function buildRiskContext(params: {
  asset: string;
  timeframe: string;
  priceNow: number;
  atr: number;
  levels?: any[];
  fib?: any[];
  geometry?: any;
}): RiskContext {
  return {
    asset: params.asset,
    timeframe: params.timeframe,
    priceNow: params.priceNow,
    atr: params.atr,
    levels: params.levels,
    fib: params.fib,
    geometry: params.geometry,
  };
}
