/**
 * Phase R10.C: RSI Divergence Detector
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import {
  lastTwoSwings,
  isRegularBullDiv,
  isRegularBearDiv,
  isHiddenBullDiv,
  isHiddenBearDiv,
} from './divergence_utils.js';

export interface RSIDivContext {
  candles: { c: number }[];
  indicators?: {
    rsi?: number[];
  };
}

export function detectRSIDivergence(ctx: RSIDivContext, pivots: Pivot[]): PatternResult[] {
  const rsi = ctx.indicators?.rsi;
  if (!rsi || rsi.length !== ctx.candles.length) return [];
  
  const results: PatternResult[] = [];
  
  // Check for divergence at highs (bearish divergence)
  const highs = lastTwoSwings(pivots, 'HIGH');
  if (highs) {
    const { p1, p2 } = highs;
    const r1 = rsi[p1.index];
    const r2 = rsi[p2.index];
    
    if (r1 != null && r2 != null) {
      // Regular bearish: higher high + lower RSI high
      if (isRegularBearDiv(p1.price, p2.price, r1, r2)) {
        results.push({
          type: 'RSI_DIV_BEAR',
          direction: 'BEAR',
          confidence: 0.75,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { rsi1: r1, rsi2: r2, divType: 'regular' },
        });
      }
      
      // Hidden bearish: lower high + higher RSI high
      if (isHiddenBearDiv(p1.price, p2.price, r1, r2)) {
        results.push({
          type: 'RSI_HIDDEN_DIV_BEAR',
          direction: 'BEAR',
          confidence: 0.70,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { rsi1: r1, rsi2: r2, divType: 'hidden' },
        });
      }
    }
  }
  
  // Check for divergence at lows (bullish divergence)
  const lows = lastTwoSwings(pivots, 'LOW');
  if (lows) {
    const { p1, p2 } = lows;
    const r1 = rsi[p1.index];
    const r2 = rsi[p2.index];
    
    if (r1 != null && r2 != null) {
      // Regular bullish: lower low + higher RSI low
      if (isRegularBullDiv(p1.price, p2.price, r1, r2)) {
        results.push({
          type: 'RSI_DIV_BULL',
          direction: 'BULL',
          confidence: 0.75,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { rsi1: r1, rsi2: r2, divType: 'regular' },
        });
      }
      
      // Hidden bullish: higher low + lower RSI low
      if (isHiddenBullDiv(p1.price, p2.price, r1, r2)) {
        results.push({
          type: 'RSI_HIDDEN_DIV_BULL',
          direction: 'BULL',
          confidence: 0.70,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { rsi1: r1, rsi2: r2, divType: 'hidden' },
        });
      }
    }
  }
  
  return results;
}
