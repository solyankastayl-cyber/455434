/**
 * Phase R3: Pennant Detector
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findImpulse } from '../utils/impulse_utils.js';
import { detectTriangleCore } from './triangle_engine.js';

export function detectPennant(input: PatternInput, pivots: Pivot[], tolY: number): PatternResult[] {
  const impulse = findImpulse(input.candles, Math.max(0, input.candles.length - 80), 10, 0.03);
  if (!impulse) return [];
  
  const after = pivots.filter(p => p.index >= impulse.end);
  const highs = after.filter(p => p.kind === 'HIGH').map(p => ({ x: p.index, y: p.price }));
  const lows = after.filter(p => p.kind === 'LOW').map(p => ({ x: p.index, y: p.price }));
  
  const core = detectTriangleCore({
    highs,
    lows,
    tolY,
    minTouches: 2,
    minBars: 6,
    maxApexAheadBars: 15,
  });
  
  if (!core) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.25 * core.convergence + 0.10 * impulse.movePct);
  
  return [{
    type: 'pennant',
    direction: impulse.direction,
    confidence: conf,
    startIndex: impulse.start,
    endIndex: core.endIndex,
    priceLevels: [core.apexY],
  }];
}
