/**
 * Phase R10.C: MACD Divergence Detector
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import {
  lastTwoSwings,
  isRegularBullDiv,
  isRegularBearDiv,
} from './divergence_utils.js';

export interface MACDDivContext {
  candles: { c: number }[];
  indicators?: {
    macd?: {
      hist?: number[];
    };
  };
}

export function detectMACDDivergence(ctx: MACDDivContext, pivots: Pivot[]): PatternResult[] {
  const macdHist = ctx.indicators?.macd?.hist;
  if (!macdHist || macdHist.length !== ctx.candles.length) return [];
  
  const results: PatternResult[] = [];
  
  // Bearish divergence at highs
  const highs = lastTwoSwings(pivots, 'HIGH');
  if (highs) {
    const { p1, p2 } = highs;
    const m1 = macdHist[p1.index];
    const m2 = macdHist[p2.index];
    
    if (m1 != null && m2 != null) {
      // Regular bearish: higher high + lower MACD high
      if (isRegularBearDiv(p1.price, p2.price, m1, m2)) {
        results.push({
          type: 'MACD_DIV_BEAR',
          direction: 'BEAR',
          confidence: 0.74,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { macd1: m1, macd2: m2 },
        });
      }
    }
  }
  
  // Bullish divergence at lows
  const lows = lastTwoSwings(pivots, 'LOW');
  if (lows) {
    const { p1, p2 } = lows;
    const m1 = macdHist[p1.index];
    const m2 = macdHist[p2.index];
    
    if (m1 != null && m2 != null) {
      // Regular bullish: lower low + higher MACD low
      if (isRegularBullDiv(p1.price, p2.price, m1, m2)) {
        results.push({
          type: 'MACD_DIV_BULL',
          direction: 'BULL',
          confidence: 0.74,
          startIndex: p1.index,
          endIndex: p2.index,
          priceLevels: [p1.price, p2.price],
          meta: { macd1: m1, macd2: m2 },
        });
      }
    }
  }
  
  return results;
}
