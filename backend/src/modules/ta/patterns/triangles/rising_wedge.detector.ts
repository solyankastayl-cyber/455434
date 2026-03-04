/**
 * Phase R3: Rising Wedge Detector
 */

import { PatternResult, Point } from '../utils/pattern_types.js';
import { detectTriangleCore } from './triangle_engine.js';

export function detectRisingWedge(params: {
  highs: Point[];
  lows: Point[];
  tolY: number;
}): PatternResult[] {
  const core = detectTriangleCore({
    highs: params.highs,
    lows: params.lows,
    tolY: params.tolY,
    minTouches: 2,
    minBars: 10,
    maxApexAheadBars: 20,
  });
  
  if (!core) return [];
  
  const au = core.upper.line.a;
  const al = core.lower.line.a;
  
  // Both rising, upper rises slower
  if (!(au > 0.00005 && al > 0.00005)) return [];
  if (!(au < al)) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.35 * core.convergence + 0.03 * (core.touchesUpper + core.touchesLower));
  
  return [{
    type: 'rising_wedge',
    direction: 'BEAR',
    confidence: conf,
    startIndex: core.startIndex,
    endIndex: core.endIndex,
    priceLevels: [core.apexY],
  }];
}
