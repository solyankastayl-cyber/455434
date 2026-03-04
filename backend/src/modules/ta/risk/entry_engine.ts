/**
 * Phase G: Entry Engine
 * 
 * Computes entry price based on setup kind and context
 */

import { EntryType, RiskContext } from './risk_types.js';
import { inferSetupKind } from './adapters/pattern_mapper.js';

function nearestAbove(levels: any[] | undefined, price: number): number | null {
  if (!levels?.length) return null;
  const above = levels.map(z => z.mid).filter(p => p > price).sort((a, b) => a - b);
  return above.length ? above[0] : null;
}

function nearestBelow(levels: any[] | undefined, price: number): number | null {
  if (!levels?.length) return null;
  const below = levels.map(z => z.mid).filter(p => p < price).sort((a, b) => b - a);
  return below.length ? below[0] : null;
}

export function computeEntry(params: {
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  components: any[];
  ctx: RiskContext;
}): { type: EntryType; price: number | null; rationale: string[] } {
  const { direction, components, ctx } = params;
  const kind = inferSetupKind(components);
  const rationale: string[] = [];
  const atrBuf = ctx.atr * 0.15;

  if (direction === 'NEUTRAL') {
    return { type: 'WAIT', price: null, rationale: ['neutral_direction'] };
  }

  // BREAKOUT_RETEST
  if (kind === 'BREAKOUT_RETEST') {
    if (direction === 'BULL') {
      const trigger = nearestAbove(ctx.levels, ctx.priceNow);
      if (trigger) {
        rationale.push('breakout_trigger_nearest_resistance');
        return { type: 'BREAKOUT_TRIGGER', price: trigger + atrBuf, rationale };
      }
    } else {
      const trigger = nearestBelow(ctx.levels, ctx.priceNow);
      if (trigger) {
        rationale.push('breakdown_trigger_nearest_support');
        return { type: 'BREAKOUT_TRIGGER', price: trigger - atrBuf, rationale };
      }
    }
    rationale.push('no_levels_fallback_market');
    return { type: 'MARKET', price: ctx.priceNow, rationale };
  }

  // TRIANGLE
  if (kind === 'TRIANGLE') {
    const upper = ctx.geometry?.upperLinePriceNow ?? nearestAbove(ctx.levels, ctx.priceNow);
    const lower = ctx.geometry?.lowerLinePriceNow ?? nearestBelow(ctx.levels, ctx.priceNow);

    if (direction === 'BULL') {
      const p = upper ?? ctx.priceNow;
      rationale.push(upper ? 'triangle_upper_break' : 'triangle_no_geometry_market');
      return { type: 'TRIANGLE_BREAK', price: p + atrBuf, rationale };
    } else {
      const p = lower ?? ctx.priceNow;
      rationale.push(lower ? 'triangle_lower_break' : 'triangle_no_geometry_market');
      return { type: 'TRIANGLE_BREAK', price: p - atrBuf, rationale };
    }
  }

  // CHANNEL
  if (kind === 'CHANNEL') {
    const upper = ctx.geometry?.channelUpperNow ?? nearestAbove(ctx.levels, ctx.priceNow);
    const lower = ctx.geometry?.channelLowerNow ?? nearestBelow(ctx.levels, ctx.priceNow);

    if (direction === 'BULL') {
      const p = upper ?? ctx.priceNow;
      rationale.push(upper ? 'channel_upper_break' : 'channel_no_geometry_market');
      return { type: 'CHANNEL_BREAK', price: p + atrBuf, rationale };
    } else {
      const p = lower ?? ctx.priceNow;
      rationale.push(lower ? 'channel_lower_break' : 'channel_no_geometry_market');
      return { type: 'CHANNEL_BREAK', price: p - atrBuf, rationale };
    }
  }

  // REVERSAL_NECKLINE
  if (kind === 'REVERSAL_NECKLINE') {
    const neck = ctx.geometry?.necklineNow ?? 
      (direction === 'BULL' ? nearestAbove(ctx.levels, ctx.priceNow) : nearestBelow(ctx.levels, ctx.priceNow));
    
    if (neck) {
      rationale.push('neckline_break_entry');
      return { 
        type: 'NECKLINE_BREAK', 
        price: direction === 'BULL' ? neck + atrBuf : neck - atrBuf, 
        rationale 
      };
    }
    rationale.push('no_neckline_fallback_market');
    return { type: 'MARKET', price: ctx.priceNow, rationale };
  }

  // HARMONIC - entry at D point completion
  if (kind === 'HARMONIC') {
    const dPoint = ctx.geometry?.dPoint ?? ctx.priceNow;
    rationale.push('harmonic_d_point_entry');
    return { type: 'MARKET', price: dPoint, rationale };
  }

  // Default: market entry
  rationale.push(`default_market_kind=${kind}`);
  return { type: 'MARKET', price: ctx.priceNow, rationale };
}
