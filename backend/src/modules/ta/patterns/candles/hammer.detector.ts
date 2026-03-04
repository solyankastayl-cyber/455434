/**
 * Phase R6: Hammer / Shooting Star Detector
 * Single-candle reversal patterns
 */

import { PatternInput, PatternResult, Candle } from '../utils/pattern_types.js';
import { body, range, upperWick, lowerWick, isBullish, isBearish } from '../utils/candle_utils.js';

export function detectHammerShootingStar(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const candleRange = range(candle);
    
    if (candleRange === 0) continue;
    
    const candleBody = body(candle);
    const upper = upperWick(candle);
    const lower = lowerWick(candle);
    
    // Body should be in upper or lower third of range
    const bodyPct = candleBody / candleRange;
    if (bodyPct > 0.35) continue; // Body too large
    
    const upperRatio = upper / candleRange;
    const lowerRatio = lower / candleRange;
    
    // Hammer: small body at top, long lower wick (>60%), small upper wick
    if (lowerRatio > 0.60 && upperRatio < 0.15) {
      const trend = detectTrend(candles, i, 5);
      if (trend === 'down') {
        const conf = Math.min(0.85, 0.55 + 0.15 * lowerRatio);
        results.push({
          type: 'CANDLE_HAMMER',
          direction: 'BULL',
          confidence: conf,
          startIndex: i,
          endIndex: i,
          priceLevels: [candle.l, candle.h],
          meta: { lowerWickRatio: lowerRatio },
        });
      }
    }
    
    // Shooting Star: small body at bottom, long upper wick (>60%), small lower wick
    if (upperRatio > 0.60 && lowerRatio < 0.15) {
      const trend = detectTrend(candles, i, 5);
      if (trend === 'up') {
        const conf = Math.min(0.85, 0.55 + 0.15 * upperRatio);
        results.push({
          type: 'CANDLE_SHOOTING_STAR',
          direction: 'BEAR',
          confidence: conf,
          startIndex: i,
          endIndex: i,
          priceLevels: [candle.h, candle.l],
          meta: { upperWickRatio: upperRatio },
        });
      }
    }
  }
  
  return results;
}

function detectTrend(candles: Candle[], idx: number, lookback: number): 'up' | 'down' | 'none' {
  if (idx < lookback) return 'none';
  
  const start = candles[idx - lookback].c;
  const end = candles[idx - 1].c;
  const change = (end - start) / start;
  
  if (change > 0.02) return 'up';
  if (change < -0.02) return 'down';
  return 'none';
}
