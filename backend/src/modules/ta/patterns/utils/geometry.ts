/**
 * Phase R: Geometry Utilities
 * Line fitting, distances, intersections
 */

import { Point, Line } from './pattern_types.js';

/**
 * Create line from two points
 */
export function lineFrom2(p1: Point, p2: Point): Line {
  const dx = (p2.x - p1.x) || 1e-9;
  const a = (p2.y - p1.y) / dx;
  const b = p1.y - a * p1.x;
  return { a, b };
}

/**
 * Get y value at x position
 */
export function yAt(line: Line, x: number): number {
  return line.a * x + line.b;
}

/**
 * Distance from point to line
 */
export function distPointLine(p: Point, line: Line): number {
  const A = line.a;
  const B = -1;
  const C = line.b;
  return Math.abs(A * p.x + B * p.y + C) / Math.sqrt(A * A + B * B);
}

/**
 * Find intersection of two lines
 */
export function intersection(l1: Line, l2: Line): Point | null {
  const denom = l1.a - l2.a;
  if (Math.abs(denom) < 1e-9) return null;
  const x = (l2.b - l1.b) / denom;
  const y = yAt(l1, x);
  return { x, y };
}

/**
 * Fit line using least squares
 */
export function fitLineLeastSquares(points: Point[]): Line {
  const n = points.length;
  if (n < 2) return { a: 0, b: points[0]?.y ?? 0 };
  
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  
  const denom = n * sumXX - sumX * sumX;
  const a = Math.abs(denom) < 1e-9 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;
  
  return { a, b };
}

/**
 * Robust line fit (mini-RANSAC)
 */
export function fitLineRobust(points: Point[], tolY: number): { line: Line; inliers: Point[] } {
  if (points.length < 2) {
    return { line: { a: 0, b: points[0]?.y ?? 0 }, inliers: points };
  }
  
  let bestLine = lineFrom2(points[0], points[points.length - 1]);
  let bestInliers: Point[] = [];
  
  const tries = Math.min(40, points.length * points.length);
  
  for (let t = 0; t < tries; t++) {
    const i = Math.floor(Math.random() * points.length);
    let j = Math.floor(Math.random() * points.length);
    if (j === i) j = (j + 1) % points.length;
    
    const cand = lineFrom2(points[i], points[j]);
    const inl = points.filter(p => distPointLine(p, cand) <= tolY);
    
    if (inl.length > bestInliers.length) {
      bestInliers = inl;
      bestLine = cand;
    }
  }
  
  const refined = bestInliers.length >= 2 ? fitLineLeastSquares(bestInliers) : bestLine;
  return { line: refined, inliers: bestInliers.length ? bestInliers : points };
}

/**
 * Calculate slope of points
 */
export function slope(points: Point[]): number {
  if (points.length < 2) return 0;
  const a = points[0];
  const b = points[points.length - 1];
  return (b.y - a.y) / Math.max(1e-9, b.x - a.x);
}
