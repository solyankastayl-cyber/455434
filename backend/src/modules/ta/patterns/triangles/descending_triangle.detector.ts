/**
 * Phase R3: Descending Triangle Detector
 */

import { PatternResult, Point } from '../utils/pattern_types.js';
import { detectTriangleCore } from './triangle_engine.js';

export function detectDescendingTriangle(params: {
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
  
  const flatLower = Math.abs(al) < 0.00005;
  const fallingUpper = au < -0.00005;
  
  if (!flatLower || !fallingUpper) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.35 * core.convergence + 0.05 * (core.touchesUpper + core.touchesLower));
  
  return [{
    type: 'descending_triangle',
    direction: 'BEAR',
    confidence: conf,
    startIndex: core.startIndex,
    endIndex: core.endIndex,
    priceLevels: [core.apexY],
  }];
}
