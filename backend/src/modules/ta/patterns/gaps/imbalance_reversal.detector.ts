/**
 * Phase R10.A: Imbalance Reversal Detector
 * Price revisits FVG zone and rejects
 */

import { PatternResult } from '../utils/pattern_types.js';
import { hasFVG, Candle } from './gaps_utils.js';

export function detectImbalanceReversal(candles: Candle[], lookahead = 12): PatternResult[] {
  const results: PatternResult[] = [];
  
  for (let i = 2; i < candles.length - 1; i++) {
    const a = candles[i - 2];
    const b = candles[i - 1];
    const c = candles[i];
    
    const fvg = hasFVG(a, b, c);
    if (!fvg) continue;
    
    // Bull FVG zone
    if (fvg.type === 'BULL') {
      const zLow = a.h;
      const zHigh = c.l;
      
      for (let k = i + 1; k <= Math.min(candles.length - 1, i + lookahead); k++) {
        const x = candles[k];
        
        // Price touches zone
        const touched = x.l <= zHigh && x.h >= zLow;
        // Bullish rejection (closes green)
        const reject = x.c > x.o;
        
        if (touched && reject) {
          results.push({
            type: 'IMBALANCE_REVERSAL',
            direction: 'BULL',
            confidence: 0.76,
            startIndex: i - 2,
            endIndex: k,
            priceLevels: [zLow, zHigh],
            meta: { fvgType: 'bull', rejectBar: k },
          });
          break;
        }
      }
    }
    
    // Bear FVG zone
    if (fvg.type === 'BEAR') {
      const zLow = c.h;
      const zHigh = a.l;
      
      for (let k = i + 1; k <= Math.min(candles.length - 1, i + lookahead); k++) {
        const x = candles[k];
        
        const touched = x.h >= zLow && x.l <= zHigh;
        const reject = x.c < x.o;
        
        if (touched && reject) {
          results.push({
            type: 'IMBALANCE_REVERSAL',
            direction: 'BEAR',
            confidence: 0.76,
            startIndex: i - 2,
            endIndex: k,
            priceLevels: [zLow, zHigh],
            meta: { fvgType: 'bear', rejectBar: k },
          });
          break;
        }
      }
    }
  }
  
  return results;
}
