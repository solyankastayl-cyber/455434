/**
 * Phase R2: Trendline Break Detector
 */

import { PatternInput, PatternResult } from '../utils/pattern_types.js';
import { findSwingLows, findSwingHighs } from '../utils/swing_points.js';
import { lineFrom2, yAt } from '../utils/geometry.js';

export function detectTrendlineBreak(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 25) return results;
  
  const lows = findSwingLows(candles.slice(0, 20), 2);
  const highs = findSwingHighs(candles.slice(0, 20), 2);
  
  // Uptrend line (from lows)
  if (lows.length >= 2) {
    const line = lineFrom2(
      { x: lows[0].index, y: lows[0].price },
      { x: lows[lows.length - 1].index, y: lows[lows.length - 1].price }
    );
    
    // Bearish break
    for (let i = 20; i < candles.length; i++) {
      const level = yAt(line, i);
      if (candles[i].c < level && candles[i - 1].c >= level) {
        results.push({
          type: 'trendline_break',
          direction: 'BEAR',
          confidence: 0.70,
          startIndex: 0,
          endIndex: i,
          priceLevels: [level],
        });
        break;
      }
    }
  }
  
  // Downtrend line (from highs)
  if (highs.length >= 2) {
    const line = lineFrom2(
      { x: highs[0].index, y: highs[0].price },
      { x: highs[highs.length - 1].index, y: highs[highs.length - 1].price }
    );
    
    // Bullish break
    for (let i = 20; i < candles.length; i++) {
      const level = yAt(line, i);
      if (candles[i].c > level && candles[i - 1].c <= level) {
        results.push({
          type: 'trendline_break',
          direction: 'BULL',
          confidence: 0.70,
          startIndex: 0,
          endIndex: i,
          priceLevels: [level],
        });
        break;
      }
    }
  }
  
  return results;
}
