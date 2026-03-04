/**
 * Phase G: Stop Engine
 * 
 * Computes stop loss price
 * Priority: 1) Structure 2) Level Zone 3) ATR fallback
 */

import { StopType, RiskContext } from './risk_types.js';

function nearestBelow(levels: any[] | undefined, price: number): number | null {
  if (!levels?.length) return null;
  const below = levels.map(z => z.low ?? z.mid).filter(p => p < price).sort((a, b) => b - a);
  return below.length ? below[0] : null;
}

function nearestAbove(levels: any[] | undefined, price: number): number | null {
  if (!levels?.length) return null;
  const above = levels.map(z => z.high ?? z.mid).filter(p => p > price).sort((a, b) => a - b);
  return above.length ? above[0] : null;
}

export function computeStop(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  ctx: RiskContext;
}): { type: StopType; price: number | null; rationale: string[] } {
  const { side, entryPrice, ctx } = params;
  const rationale: string[] = [];

  // 1) Structure stop from geometry
  const structural = ctx.geometry?.stopStructurePrice;
  if (typeof structural === 'number' && structural > 0) {
    rationale.push('structure_stop_from_geometry');
    return { type: 'STRUCTURE', price: structural, rationale };
  }

  // 2) Level zone stop
  if (side === 'LONG') {
    const lvl = nearestBelow(ctx.levels, entryPrice);
    if (lvl) {
      rationale.push('stop_below_nearest_level_zone');
      return { type: 'LEVEL_ZONE', price: lvl - ctx.atr * 0.1, rationale };
    }
  } else {
    const lvl = nearestAbove(ctx.levels, entryPrice);
    if (lvl) {
      rationale.push('stop_above_nearest_level_zone');
      return { type: 'LEVEL_ZONE', price: lvl + ctx.atr * 0.1, rationale };
    }
  }

  // 3) ATR fallback
  const k = 1.5;
  const stop = side === 'LONG' ? entryPrice - ctx.atr * k : entryPrice + ctx.atr * k;
  rationale.push(`atr_stop_k=${k}`);
  return { type: 'ATR', price: stop, rationale };
}
