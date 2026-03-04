/**
 * Phase R: Impulse Utilities
 */

import { Candle } from './pattern_types.js';

export function findImpulse(candles: Candle[], startFrom: number, window = 12, minMovePct = 0.03) {
  for (let i = startFrom; i < candles.length - window; i++) {
    const a = candles[i].c;
    const b = candles[i + window].c;
    const move = (b - a) / a;
    
    if (Math.abs(move) >= minMovePct) {
      return {
        start: i,
        end: i + window,
        direction: move > 0 ? 'BULL' : 'BEAR' as 'BULL' | 'BEAR',
        movePct: Math.abs(move),
      };
    }
  }
  return null;
}
