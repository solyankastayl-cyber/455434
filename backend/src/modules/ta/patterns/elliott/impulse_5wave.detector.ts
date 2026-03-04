/**
 * Phase R8: Elliott 5-Wave Impulse Detector
 * 
 * Detects classic 5-wave impulse structure:
 * - Wave 1: Initial impulse
 * - Wave 2: Corrective (retraces part of Wave 1)
 * - Wave 3: Main impulse (usually longest)
 * - Wave 4: Corrective (should not overlap Wave 1)
 * - Wave 5: Final impulse (often with divergence)
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import { alternating, getWaveSizes, validateElliottRules } from './elliott_utils.js';

export function detectImpulse5Wave(pivots: Pivot[]): PatternResult[] {
  const results: PatternResult[] = [];
  
  if (pivots.length < 6) return results;
  
  for (let i = 0; i < pivots.length - 5; i++) {
    const p = pivots.slice(i, i + 6);
    
    // Must alternate HIGH/LOW
    if (!alternating(p)) continue;
    
    const waves = getWaveSizes(p);
    if (!waves) continue;
    
    const { w1, w2, w3, w4, w5 } = waves;
    
    // Validate Elliott rules
    const rules = validateElliottRules(waves, p);
    if (!rules.valid) continue;
    
    // Additional quality checks
    // Wave 3 should be substantial (at least 80% of Wave 1)
    if (Math.abs(w3) < Math.abs(w1) * 0.8) continue;
    
    // Wave 5 should be meaningful (at least 40% of Wave 1)
    if (Math.abs(w5) < Math.abs(w1) * 0.4) continue;
    
    // Determine direction
    const direction = w1 > 0 ? 'BULL' : 'BEAR';
    
    // Calculate confidence based on rule adherence and proportions
    let conf = 0.70;
    
    // Bonus for Wave 3 being longest
    if (Math.abs(w3) > Math.abs(w1) && Math.abs(w3) > Math.abs(w5)) {
      conf += 0.08;
    }
    
    // Bonus for fibonacci relationships
    const w2Ret = Math.abs(w2 / w1);
    if (w2Ret >= 0.38 && w2Ret <= 0.62) conf += 0.05;
    
    const w4Ret = Math.abs(w4 / w3);
    if (w4Ret >= 0.38 && w4Ret <= 0.50) conf += 0.05;
    
    results.push({
      type: 'ELLIOTT_5_WAVE',
      direction,
      confidence: Math.min(0.92, conf),
      startIndex: p[0].index,
      endIndex: p[5].index,
      priceLevels: p.map(x => x.price),
      meta: {
        waves: { w1, w2, w3, w4, w5 },
        rules,
        pivotIndices: p.map(x => x.index),
      },
    });
  }
  
  return results;
}
