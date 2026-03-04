/**
 * Phase G: Target Engine
 * 
 * Computes target prices (T1, T2, T3)
 * Priority: 1) Measured move 2) Fib extensions 3) Next SR levels
 */

import { TargetType, RiskContext } from './risk_types.js';

function nearestTargetsFromLevels(levels: any[] | undefined, from: number, side: 'LONG' | 'SHORT'): number[] {
  if (!levels?.length) return [];
  const mids = levels.map(z => z.mid).filter((n): n is number => typeof n === 'number');
  if (side === 'LONG') {
    return mids.filter(p => p > from).sort((a, b) => a - b).slice(0, 3);
  }
  return mids.filter(p => p < from).sort((a, b) => b - a).slice(0, 3);
}

function fibExts(fib: any[] | undefined): number[] {
  if (!fib?.length) return [];
  return fib
    .filter(x => x.kind === 'EXT')
    .map(x => x.price)
    .filter((p): p is number => typeof p === 'number');
}

export function computeTargets(params: {
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  ctx: RiskContext;
}): Array<{ type: TargetType; price: number | null; rationale: string[] }> {
  const { side, entryPrice, ctx } = params;

  const out: Array<{ type: TargetType; price: number | null; rationale: string[] }> = [];

  // 1) Measured move from geometry
  const mm = ctx.geometry?.measuredMoveTarget;
  if (typeof mm === 'number' && mm > 0) {
    out.push({ type: 'MEASURED_MOVE', price: mm, rationale: ['measured_move_from_pattern_geometry'] });
  }

  // 2) Fib extensions
  const fibs = fibExts(ctx.fib);
  if (fibs.length) {
    const sorted = side === 'LONG' ? fibs.sort((a, b) => a - b) : fibs.sort((a, b) => b - a);
    for (const p of sorted.slice(0, 2)) {
      out.push({ type: 'FIB_EXTENSION', price: p, rationale: ['fib_extension'] });
    }
  }

  // 3) Next levels as fallback
  const lvls = nearestTargetsFromLevels(ctx.levels, entryPrice, side);
  for (const p of lvls) {
    out.push({ type: 'NEXT_LEVEL', price: p, rationale: ['next_sr_level'] });
  }

  // Normalize to max 3 targets, unique by price
  const uniq: typeof out = [];
  const seen = new Set<string>();
  for (const t of out) {
    if (t.price === null) continue;
    const k = t.price.toFixed(2);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(t);
    if (uniq.length >= 3) break;
  }

  // Fallback if nothing found
  if (!uniq.length) {
    const fallback = side === 'LONG' ? entryPrice + ctx.atr * 2 : entryPrice - ctx.atr * 2;
    return [{ type: 'INVALID', price: fallback, rationale: ['fallback_atr_projection'] }];
  }

  return uniq;
}
