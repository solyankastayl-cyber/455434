/**
 * Phase R3: Triangle Engine Core
 */

import { Point, Line } from '../utils/pattern_types.js';
import { fitLineRobust, intersection, yAt } from '../utils/geometry.js';

export interface TriangleCandidate {
  upper: { line: Line; inliers: Point[] };
  lower: { line: Line; inliers: Point[] };
  apexX: number;
  apexY: number;
  startIndex: number;
  endIndex: number;
  touchesUpper: number;
  touchesLower: number;
  convergence: number;
}

export function detectTriangleCore(params: {
  highs: Point[];
  lows: Point[];
  tolY: number;
  minTouches?: number;
  minBars?: number;
  maxApexAheadBars?: number;
}): TriangleCandidate | null {
  const { highs, lows, tolY, minTouches = 2, minBars = 12, maxApexAheadBars = 20 } = params;
  
  if (highs.length < minTouches || lows.length < minTouches) return null;
  
  const hiFit = fitLineRobust(highs, tolY);
  const loFit = fitLineRobust(lows, tolY);
  
  const apex = intersection(hiFit.line, loFit.line);
  if (!apex) return null;
  
  const startIndex = Math.min(highs[0].x, lows[0].x);
  const endIndex = Math.max(highs[highs.length - 1].x, lows[lows.length - 1].x);
  
  const bars = endIndex - startIndex;
  if (bars < minBars) return null;
  
  if (apex.x <= startIndex) return null;
  if (apex.x > endIndex + maxApexAheadBars) return null;
  
  const touchesUpper = hiFit.inliers.length;
  const touchesLower = loFit.inliers.length;
  if (touchesUpper < minTouches || touchesLower < minTouches) return null;
  
  const upperStart = yAt(hiFit.line, startIndex);
  const lowerStart = yAt(loFit.line, startIndex);
  const upperEnd = yAt(hiFit.line, endIndex);
  const lowerEnd = yAt(loFit.line, endIndex);
  
  const w0 = Math.max(1e-9, upperStart - lowerStart);
  const w1 = Math.max(1e-9, upperEnd - lowerEnd);
  
  if (w1 >= w0 * 0.85) return null;
  
  const convergence = 1 - (w1 / w0);
  
  return {
    upper: { line: hiFit.line, inliers: hiFit.inliers },
    lower: { line: loFit.line, inliers: loFit.inliers },
    apexX: apex.x,
    apexY: apex.y,
    startIndex,
    endIndex,
    touchesUpper,
    touchesLower,
    convergence,
  };
}
