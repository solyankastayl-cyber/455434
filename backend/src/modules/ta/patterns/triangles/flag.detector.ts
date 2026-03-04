/**
 * Phase R3: Flag Detector
 */

import { PatternInput, PatternResult, Pivot } from '../utils/pattern_types.js';
import { findImpulse } from '../utils/impulse_utils.js';
import { fitLineRobust, yAt } from '../utils/geometry.js';

export function detectFlag(input: PatternInput, pivots: Pivot[], tolY: number): PatternResult[] {
  const impulse = findImpulse(input.candles, Math.max(0, input.candles.length - 120), 12, 0.04);
  if (!impulse) return [];
  
  const after = pivots.filter(p => p.index >= impulse.end);
  const highs = after.filter(p => p.kind === 'HIGH').map(p => ({ x: p.index, y: p.price }));
  const lows = after.filter(p => p.kind === 'LOW').map(p => ({ x: p.index, y: p.price }));
  
  if (highs.length < 2 || lows.length < 2) return [];
  
  const hiFit = fitLineRobust(highs, tolY);
  const loFit = fitLineRobust(lows, tolY);
  
  // Must be roughly parallel
  if (Math.abs(hiFit.line.a - loFit.line.a) > 0.00008) return [];
  
  const poleStart = input.candles[impulse.start].c;
  const poleEnd = input.candles[impulse.end].c;
  const poleMove = Math.abs((poleEnd - poleStart) / poleStart);
  
  const consEndPrice = input.candles[input.candles.length - 1].c;
  const retrace = impulse.direction === 'BULL'
    ? (poleEnd - consEndPrice) / Math.max(1e-9, poleEnd - poleStart)
    : (consEndPrice - poleEnd) / Math.max(1e-9, poleStart - poleEnd);
  
  if (retrace > 0.60) return [];
  
  const conf = Math.min(0.95, 0.55 + 0.15 * poleMove + 0.15 * (hiFit.inliers.length + loFit.inliers.length) / 6);
  
  return [{
    type: 'flag',
    direction: impulse.direction,
    confidence: conf,
    startIndex: impulse.start,
    endIndex: input.candles.length - 1,
    priceLevels: [
      yAt(hiFit.line, input.candles.length - 1),
      yAt(loFit.line, input.candles.length - 1),
    ],
  }];
}
