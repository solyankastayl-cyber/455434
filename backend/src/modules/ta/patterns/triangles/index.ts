/**
 * Phase R3: Triangle Detectors
 */

import { PatternInput, PatternResult, Pivot, Point } from '../utils/pattern_types.js';
import { detectAscendingTriangle } from './ascending_triangle.detector.js';
import { detectDescendingTriangle } from './descending_triangle.detector.js';
import { detectSymTriangle } from './sym_triangle.detector.js';
import { detectRisingWedge } from './rising_wedge.detector.js';
import { detectFallingWedge } from './falling_wedge.detector.js';
import { detectPennant } from './pennant.detector.js';
import { detectFlag } from './flag.detector.js';

export function runTriangleDetectors(
  input: PatternInput,
  pivots: Pivot[],
  tolY: number
): PatternResult[] {
  const highs = pivots.filter(p => p.kind === 'HIGH').map(p => ({ x: p.index, y: p.price }));
  const lows = pivots.filter(p => p.kind === 'LOW').map(p => ({ x: p.index, y: p.price }));
  
  return [
    ...detectAscendingTriangle({ highs, lows, tolY }),
    ...detectDescendingTriangle({ highs, lows, tolY }),
    ...detectSymTriangle({ highs, lows, tolY }),
    ...detectRisingWedge({ highs, lows, tolY }),
    ...detectFallingWedge({ highs, lows, tolY }),
    ...detectPennant(input, pivots, tolY),
    ...detectFlag(input, pivots, tolY),
  ];
}

export {
  detectAscendingTriangle,
  detectDescendingTriangle,
  detectSymTriangle,
  detectRisingWedge,
  detectFallingWedge,
  detectPennant,
  detectFlag,
};
