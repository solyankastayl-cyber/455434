/**
 * Phase R3: Symmetric Triangle Detector
 */

import { PatternResult, Point } from '../utils/pattern_types.js';
import { detectTriangleCore } from './triangle_engine.js';

export function detectSymTriangle(params: {
  highs: Point[];
  lows: Point[];
  tolY: number;
}): PatternResult[] {
  const core = detectTriangleCore({
    highs: params.highs,
    lows: params.lows,
    tolY: params.tolY,
    minTouches: 2,
    minBars: 12,
    maxApexAheadBars: 20,
  });
  
  if (!core) return [];
  
  const au = core.upper.line.a;
  const al = core.lower.line.a;
  
  const fallingUpper = au < -0.00005;
  const risingLower = al > 0.00005;
  
  if (!fallingUpper || !risingLower) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.40 * core.convergence + 0.04 * (core.touchesUpper + core.touchesLower));
  
  return [{
    type: 'sym_triangle',
    direction: 'NEUTRAL',
    confidence: conf,
    startIndex: core.startIndex,
    endIndex: core.endIndex,
    priceLevels: [core.apexY],
  }];
}
