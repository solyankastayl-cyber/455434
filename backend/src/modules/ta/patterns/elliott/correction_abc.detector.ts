/**
 * Phase R8: ABC Correction Detector
 * 
 * Detects 3-wave corrective structure:
 * - Wave A: Initial corrective move
 * - Wave B: Partial retracement of A
 * - Wave C: Final corrective move (often = Wave A)
 */

import { PatternResult, Pivot } from '../utils/pattern_types.js';
import { alternating, retrace } from './elliott_utils.js';

export function detectABCCorrection(pivots: Pivot[]): PatternResult[] {
  const results: PatternResult[] = [];
  
  if (pivots.length < 4) return results;
  
  for (let i = 0; i < pivots.length - 3; i++) {
    const [a, b, c, d] = pivots.slice(i, i + 4);
    
    // Must alternate
    if (a.kind === b.kind || b.kind === c.kind || c.kind === d.kind) continue;
    
    const ab = b.price - a.price;
    const bc = c.price - b.price;
    const cd = d.price - c.price;
    
    // ABC: alternating directions
    if (Math.sign(ab) === Math.sign(bc)) continue;
    if (Math.sign(bc) === Math.sign(cd)) continue;
    
    // Wave B should retrace 38.2% - 78.6% of Wave A
    const bRetrace = retrace(a.price, b.price, c.price);
    if (bRetrace < 0.30 || bRetrace > 0.85) continue;
    
    // Wave C should be substantial
    const cSize = Math.abs(cd);
    const aSize = Math.abs(ab);
    if (cSize < aSize * 0.5) continue;
    
    // Direction based on Wave C
    const direction = cd > 0 ? 'BULL' : 'BEAR';
    
    // Confidence based on fibonacci relationships
    let conf = 0.68;
    
    // Bonus if Wave B retraces 50-61.8%
    if (bRetrace >= 0.50 && bRetrace <= 0.618) conf += 0.07;
    
    // Bonus if Wave C ≈ Wave A
    const cToARatio = cSize / Math.max(1e-9, aSize);
    if (cToARatio >= 0.9 && cToARatio <= 1.1) conf += 0.08;
    
    results.push({
      type: 'CORRECTION_ABC',
      direction,
      confidence: Math.min(0.88, conf),
      startIndex: a.index,
      endIndex: d.index,
      priceLevels: [a.price, b.price, c.price, d.price],
      meta: {
        waveA: ab,
        waveB: bc,
        waveC: cd,
        bRetracement: bRetrace,
        cToARatio,
      },
    });
  }
  
  return results;
}
