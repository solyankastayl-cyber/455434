/**
 * Line/Channel Fitter — Geometric utilities for pattern detection
 * 
 * Production-friendly minimal line fitting utilities.
 * No external deps. Robust enough for 1D pivots fitting.
 * 
 * Used by:
 * - Triangle Detector
 * - Flag/Pennant Detector
 * - Channel Detector
 * - Trendline Detector
 * - Wedge Detector
 */

export type Point = { x: number; y: number };

export type Line = {
  slope: number;      // m
  intercept: number;  // b (y = mx + b)
};

/**
 * Least squares fit: y = m*x + b
 */
export function fitLineLS(points: Point[]): Line | null {
  const n = points.length;
  if (n < 2) return null;

  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXX += p.x * p.x;
    sumXY += p.x * p.y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const m = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - m * sumX) / n;
  return { slope: m, intercept: b };
}

/**
 * Get Y value on line at X
 */
export function yOnLine(line: Line, x: number): number {
  return line.slope * x + line.intercept;
}

/**
 * Perpendicular distance from point to line
 */
export function distancePointLine(p: Point, line: Line): number {
  // line: y = mx + b -> mx - y + b = 0
  const A = line.slope;
  const B = -1;
  const C = line.intercept;
  return Math.abs(A * p.x + B * p.y + C) / Math.sqrt(A * A + B * B);
}

/**
 * Find intersection point of two lines
 */
export function lineIntersection(l1: Line, l2: Line): Point | null {
  // m1 x + b1 = m2 x + b2 -> x = (b2 - b1)/(m1 - m2)
  const denom = (l1.slope - l2.slope);
  if (Math.abs(denom) < 1e-12) return null;
  const x = (l2.intercept - l1.intercept) / denom;
  const y = yOnLine(l1, x);
  return { x, y };
}

/**
 * Lightweight "RANSAC-like": sample pairs, choose best by inliers.
 * Works well with pivot sets (small count).
 * 
 * Phase S3: Now uses seeded RNG for determinism
 */
import { getRNG } from '../infra/rng.js';

export function fitLineRobust(
  points: Point[],
  tolerance: number,
  iters = 64
): { line: Line; inliers: Point[]; mse: number } | null {
  if (points.length < 2) return null;

  // If too few points, fallback to LS
  if (points.length <= 3) {
    const line = fitLineLS(points);
    if (!line) return null;
    const mse = meanSqError(points, line);
    return { line, inliers: points.slice(), mse };
  }

  let best: { line: Line; inliers: Point[]; mse: number } | null = null;

  // Phase S3: Use seeded RNG for deterministic results
  const rng = getRNG();
  const randIdx = () => rng.nextInt(0, points.length - 1);

  for (let k = 0; k < iters; k++) {
    let i = randIdx();
    let j = randIdx();
    if (i === j) j = (j + 1) % points.length;

    const p1 = points[i];
    const p2 = points[j];
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 1e-9) continue;

    const m = (p2.y - p1.y) / dx;
    const b = p1.y - m * p1.x;
    const line = { slope: m, intercept: b };

    const inliers: Point[] = [];
    for (const p of points) {
      if (distancePointLine(p, line) <= tolerance) inliers.push(p);
    }
    if (inliers.length < 2) continue;

    // Refine with LS on inliers
    const refined = fitLineLS(inliers);
    if (!refined) continue;

    const mse = meanSqError(inliers, refined);
    if (!best) {
      best = { line: refined, inliers, mse };
    } else {
      // Prefer more inliers, then lower MSE
      if (
        inliers.length > best.inliers.length ||
        (inliers.length === best.inliers.length && mse < best.mse)
      ) {
        best = { line: refined, inliers, mse };
      }
    }
  }

  // Fallback: LS
  if (!best) {
    const line = fitLineLS(points);
    if (!line) return null;
    return { line, inliers: points.slice(), mse: meanSqError(points, line) };
  }

  return best;
}

/**
 * Mean squared error of points to line
 */
function meanSqError(points: Point[], line: Line): number {
  if (points.length === 0) return Number.POSITIVE_INFINITY;
  let s = 0;
  for (const p of points) {
    const yHat = yOnLine(line, p.x);
    const e = p.y - yHat;
    s += e * e;
  }
  return s / points.length;
}

/**
 * Check if two lines are approximately parallel
 */
export function areLinesParallel(l1: Line, l2: Line, tolerance: number = 0.1): boolean {
  return Math.abs(l1.slope - l2.slope) <= tolerance;
}

/**
 * Calculate the angle between two lines (in degrees)
 */
export function angleBetweenLines(l1: Line, l2: Line): number {
  const tan1 = l1.slope;
  const tan2 = l2.slope;
  const tanAngle = Math.abs((tan1 - tan2) / (1 + tan1 * tan2));
  return Math.atan(tanAngle) * (180 / Math.PI);
}

/**
 * Fit a channel (two parallel lines) through upper and lower points
 */
export function fitChannel(
  upperPoints: Point[],
  lowerPoints: Point[],
  tolerance: number
): {
  upper: Line;
  lower: Line;
  avgSlope: number;
  width: number;
  parallel: number;
} | null {
  const upperFit = fitLineRobust(upperPoints, tolerance);
  const lowerFit = fitLineRobust(lowerPoints, tolerance);
  
  if (!upperFit || !lowerFit) return null;
  
  const avgSlope = (upperFit.line.slope + lowerFit.line.slope) / 2;
  
  // Calculate average width
  const midX = (Math.min(...upperPoints.map(p => p.x)) + Math.max(...upperPoints.map(p => p.x))) / 2;
  const width = Math.abs(yOnLine(upperFit.line, midX) - yOnLine(lowerFit.line, midX));
  
  // Parallelism score (1 = perfectly parallel, 0 = very different slopes)
  const slopeDiff = Math.abs(upperFit.line.slope - lowerFit.line.slope);
  const avgSlopeAbs = (Math.abs(upperFit.line.slope) + Math.abs(lowerFit.line.slope)) / 2;
  const parallel = 1 - Math.min(1, slopeDiff / (avgSlopeAbs + 0.0001));
  
  return {
    upper: upperFit.line,
    lower: lowerFit.line,
    avgSlope,
    width,
    parallel
  };
}
