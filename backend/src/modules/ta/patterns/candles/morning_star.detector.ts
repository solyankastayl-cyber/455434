/**
 * Phase R6: Morning Star Detector
 * Three-candle bullish reversal pattern
 * 
 * Structure:
 * 1. First candle: Large bearish candle in downtrend
 * 2. Second candle: Small body (doji-like) showing indecision
 * 3. Third candle: Large bullish candle closing well into first candle's body
 */

import { PatternInput, PatternResult, Candle } from '../utils/pattern_types.js';
import { body, range, isBullish, isBearish, bodyPct } from '../utils/candle_utils.js';

export function detectMorningStar(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  if (candles.length < 3) return [];
  
  for (let i = 2; i < candles.length; i++) {
    const first = candles[i - 2];
    const middle = candles[i - 1];
    const third = candles[i];
    
    // First candle: large bearish
    if (!isBearish(first)) continue;
    const firstBody = body(first);
    const firstRange = range(first);
    if (bodyPct(first) < 0.5) continue; // Body should be >50% of range
    
    // Second candle: small body (star)
    const middleBody = body(middle);
    if (middleBody > firstBody * 0.4) continue; // Star body should be small
    
    // Gap: star should gap below first candle's body
    const firstBodyLow = Math.min(first.o, first.c);
    // Note: In crypto/forex, gaps are rare, so we relax this
    
    // Third candle: large bullish, closes well into first candle
    if (!isBullish(third)) continue;
    const thirdBody = body(third);
    if (thirdBody < firstBody * 0.5) continue; // Third body should be substantial
    
    // Third candle should close at least halfway into first candle's body
    const firstMidpoint = (first.o + first.c) / 2;
    if (third.c < firstMidpoint) continue;
    
    // Context: should be in downtrend (look at prior candles)
    const priorTrend = detectPriorTrend(candles, i - 3, 5);
    if (priorTrend !== 'down') continue;
    
    const conf = calculateConfidence(first, middle, third);
    
    results.push({
      type: 'CANDLE_MORNING_STAR',
      direction: 'BULL',
      confidence: conf,
      startIndex: i - 2,
      endIndex: i,
      priceLevels: [middle.l, third.c],
      meta: {
        firstBody: firstBody,
        starBody: middleBody,
        thirdBody: thirdBody,
      },
    });
  }
  
  return results;
}

function detectPriorTrend(candles: Candle[], endIdx: number, lookback: number): 'up' | 'down' | 'none' {
  if (endIdx < lookback || endIdx < 0) return 'none';
  
  const start = Math.max(0, endIdx - lookback);
  let up = 0, down = 0;
  
  for (let i = start; i <= endIdx; i++) {
    if (candles[i].c > candles[i].o) up++;
    else down++;
  }
  
  if (down > up * 1.5) return 'down';
  if (up > down * 1.5) return 'up';
  return 'none';
}

function calculateConfidence(first: Candle, middle: Candle, third: Candle): number {
  let conf = 0.55;
  
  // Bonus for small star body
  const starRatio = body(middle) / body(first);
  if (starRatio < 0.2) conf += 0.10;
  
  // Bonus for strong third candle
  const thirdRatio = body(third) / body(first);
  if (thirdRatio > 0.8) conf += 0.10;
  
  // Bonus if third closes above first's open
  if (third.c > first.o) conf += 0.10;
  
  return Math.min(0.90, conf);
}
