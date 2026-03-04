/**
 * Phase R3: Falling Wedge Detector
 */

import { PatternResult, Point } from '../utils/pattern_types.js';
import { detectTriangleCore } from './triangle_engine.js';

export function detectFallingWedge(params: {
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
  
  // Both falling, lower falls slower
  if (!(au < -0.00005 && al < -0.00005)) return [];
  if (!(al > au)) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.35 * core.convergence + 0.03 * (core.touchesUpper + core.touchesLower));
  
  return [{
    type: 'falling_wedge',
    direction: 'BULL',
    confidence: conf,
    startIndex: core.startIndex,
    endIndex: core.endIndex,
    priceLevels: [core.apexY],
  }];
}
