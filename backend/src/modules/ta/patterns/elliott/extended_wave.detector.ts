/**
 * Phase R8: Extended Wave Detector
 * 
 * Detects extended waves (Wave 3 or Wave 5 > 161.8% of Wave 1)
 * Extended Wave 3 is most common in strong trends.
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import { alternating, getWaveSizes } from './elliott_utils.js';

export function detectExtendedWave(pivots: Pivot[]): PatternResult[] {
  const results: PatternResult[] = [];
  
  if (pivots.length < 6) return results;
  
  for (let i = 0; i < pivots.length - 5; i++) {
    const p = pivots.slice(i, i + 6);
    
    if (!alternating(p)) continue;
    
    const waves = getWaveSizes(p);
    if (!waves) continue;
    
    const { w1, w3, w5 } = waves;
    
    const w1Size = Math.abs(w1);
    const w3Size = Math.abs(w3);
    const w5Size = Math.abs(w5);
    
    // Extended Wave 3: Wave 3 > 161.8% of Wave 1
    if (w3Size > w1Size * 1.618) {
      const direction = w3 > 0 ? 'BULL' : 'BEAR';
      const extensionRatio = w3Size / w1Size;
      
      let conf = 0.75;
      // Bonus for strong extension
      if (extensionRatio > 2.0) conf += 0.05;
      if (extensionRatio > 2.618) conf += 0.05;
      
      results.push({
        type: 'ELLIOTT_3_WAVE', // Wave 3 Extended
        direction,
        confidence: Math.min(0.88, conf),
        startIndex: p[0].index,
        endIndex: p[5].index,
        priceLevels: p.map(x => x.price),
        meta: {
          extendedWave: 3,
          extensionRatio,
          waves: { w1, w3, w5 },
        },
      });
    }
    
    // Extended Wave 5: Wave 5 > 161.8% of Wave 1
    if (w5Size > w1Size * 1.618) {
      const direction = w5 > 0 ? 'BULL' : 'BEAR';
      const extensionRatio = w5Size / w1Size;
      
      let conf = 0.72;
      // Extended Wave 5 is less common, slightly lower base confidence
      if (extensionRatio > 2.0) conf += 0.05;
      
      results.push({
        type: 'ELLIOTT_5_WAVE', // Wave 5 Extended variant
        direction,
        confidence: Math.min(0.85, conf),
        startIndex: p[0].index,
        endIndex: p[5].index,
        priceLevels: p.map(x => x.price),
        meta: {
          extendedWave: 5,
          extensionRatio,
          waves: { w1, w3, w5 },
        },
      });
    }
  }
  
  return results;
}
