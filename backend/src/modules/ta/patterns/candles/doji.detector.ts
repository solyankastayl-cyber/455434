/**
 * Phase R6: Doji Detector
 * Single-candle indecision pattern
 * 
 * Types:
 * - Standard Doji: tiny body, equal wicks
 * - Long-Legged Doji: tiny body, long wicks both sides
 * - Dragonfly Doji: tiny body at top, long lower wick
 * - Gravestone Doji: tiny body at bottom, long upper wick
 */

import { PatternInput, PatternResult, Candle } from '../utils/pattern_types.js';
import { body, range, upperWick, lowerWick, bodyPct } from '../utils/candle_utils.js';

export function detectDoji(input: PatternInput): PatternResult[] {
  const candles = input.candles;
  const results: PatternResult[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const candleRange = range(candle);
    
    if (candleRange === 0) continue;
    
    const candleBody = body(candle);
    const bodyRatio = candleBody / candleRange;
    
    // Doji: body is very small relative to range (<10%)
    if (bodyRatio > 0.10) continue;
    
    const upper = upperWick(candle);
    const lower = lowerWick(candle);
    
    // Classify doji type
    const { type, subtype } = classifyDoji(candle, upper, lower, candleRange);
    
    // Determine direction based on context
    const direction = determineDojyDirection(candles, i);
    
    const conf = calculateConfidence(bodyRatio, upper, lower, candleRange);
    
    results.push({
      type: 'CANDLE_DOJI',
      direction,
      confidence: conf,
      startIndex: i,
      endIndex: i,
      priceLevels: [candle.h, candle.l],
      meta: {
        subtype,
        bodyRatio,
        upperWick: upper / candleRange,
        lowerWick: lower / candleRange,
      },
    });
  }
  
  return results;
}

function classifyDoji(
  candle: Candle,
  upper: number,
  lower: number,
  candleRange: number
): { type: string; subtype: string } {
  const upperRatio = upper / candleRange;
  const lowerRatio = lower / candleRange;
  
  // Dragonfly: open/close at top, long lower wick
  if (upperRatio < 0.15 && lowerRatio > 0.65) {
    return { type: 'CANDLE_DOJI', subtype: 'dragonfly' };
  }
  
  // Gravestone: open/close at bottom, long upper wick
  if (lowerRatio < 0.15 && upperRatio > 0.65) {
    return { type: 'CANDLE_DOJI', subtype: 'gravestone' };
  }
  
  // Long-legged: both wicks substantial
  if (upperRatio > 0.35 && lowerRatio > 0.35) {
    return { type: 'CANDLE_DOJI', subtype: 'long_legged' };
  }
  
  // Standard doji
  return { type: 'CANDLE_DOJI', subtype: 'standard' };
}

function determineDojyDirection(candles: Candle[], idx: number): 'NEUTRAL' | 'BULL' | 'BEAR' {
  // Doji at support after downtrend = bullish
  // Doji at resistance after uptrend = bearish
  // Otherwise neutral
  
  if (idx < 3) return 'NEUTRAL';
  
  const priorCandles = candles.slice(Math.max(0, idx - 5), idx);
  let bullCount = 0, bearCount = 0;
  
  for (const c of priorCandles) {
    if (c.c > c.o) bullCount++;
    else bearCount++;
  }
  
  // After uptrend, doji signals potential reversal (bearish)
  if (bullCount > bearCount * 1.5) return 'BEAR';
  // After downtrend, doji signals potential reversal (bullish)
  if (bearCount > bullCount * 1.5) return 'BULL';
  
  return 'NEUTRAL';
}

function calculateConfidence(
  bodyRatio: number,
  upper: number,
  lower: number,
  candleRange: number
): number {
  let conf = 0.50;
  
  // Very small body increases confidence
  if (bodyRatio < 0.05) conf += 0.10;
  
  // Long wicks increase significance
  const totalWicks = (upper + lower) / candleRange;
  if (totalWicks > 0.85) conf += 0.10;
  
  return Math.min(0.75, conf);
}
