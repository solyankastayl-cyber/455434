/**
 * TA Math Utilities — Common mathematical functions
 * 
 * Used across indicators, engines, and detectors.
 */

/**
 * Simple Moving Average
 */
export function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/**
 * Exponential Moving Average
 */
export function ema(values: number[], period: number): number {
  if (values.length < period) return NaN;
  
  const multiplier = 2 / (period + 1);
  let emaValue = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < values.length; i++) {
    emaValue = (values[i] - emaValue) * multiplier + emaValue;
  }
  
  return emaValue;
}

/**
 * Standard Deviation
 */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Linear Regression
 * Returns { slope, intercept, r2 }
 */
export function linearRegression(x: number[], y: number[]): {
  slope: number;
  intercept: number;
  r2: number;
} {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }
  
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: 0, r2: 0 };
  
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  
  // R-squared
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = slope * x[i] + intercept;
    ssTot += Math.pow(y[i] - yMean, 2);
    ssRes += Math.pow(y[i] - yPred, 2);
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  
  return { slope, intercept, r2 };
}

/**
 * RANSAC Line Fitting (Robust regression)
 * Better for noisy data with outliers
 */
export function ransacLineFit(
  points: Array<{ x: number; y: number }>,
  options: {
    iterations?: number;
    threshold?: number;
    minInliers?: number;
  } = {}
): {
  slope: number;
  intercept: number;
  inliers: number;
  score: number;
} {
  const {
    iterations = 100,
    threshold = 0.02,
    minInliers = 2
  } = options;
  
  if (points.length < 2) {
    return { slope: 0, intercept: 0, inliers: 0, score: 0 };
  }
  
  let bestSlope = 0;
  let bestIntercept = 0;
  let bestInliers = 0;
  let bestScore = 0;
  
  for (let iter = 0; iter < iterations; iter++) {
    // Random sample 2 points
    const idx1 = Math.floor(Math.random() * points.length);
    let idx2 = Math.floor(Math.random() * points.length);
    while (idx2 === idx1) {
      idx2 = Math.floor(Math.random() * points.length);
    }
    
    const p1 = points[idx1];
    const p2 = points[idx2];
    
    // Fit line through 2 points
    const dx = p2.x - p1.x;
    if (Math.abs(dx) < 1e-10) continue;
    
    const slope = (p2.y - p1.y) / dx;
    const intercept = p1.y - slope * p1.x;
    
    // Count inliers
    let inliers = 0;
    let totalError = 0;
    
    for (const p of points) {
      const yPred = slope * p.x + intercept;
      const error = Math.abs(p.y - yPred) / Math.abs(p.y || 1);
      
      if (error < threshold) {
        inliers++;
        totalError += error;
      }
    }
    
    const score = inliers > 0 ? inliers / (1 + totalError / inliers) : 0;
    
    if (inliers >= minInliers && score > bestScore) {
      bestSlope = slope;
      bestIntercept = intercept;
      bestInliers = inliers;
      bestScore = score;
    }
  }
  
  return {
    slope: bestSlope,
    intercept: bestIntercept,
    inliers: bestInliers,
    score: bestScore
  };
}

/**
 * Fibonacci ratios
 */
export const FIB_RATIOS = {
  R236: 0.236,
  R382: 0.382,
  R500: 0.5,
  R618: 0.618,
  R786: 0.786,
  E1000: 1.0,
  E1272: 1.272,
  E1618: 1.618,
  E2000: 2.0,
  E2618: 2.618
};

/**
 * Calculate Fibonacci levels between two prices
 */
export function fibLevels(high: number, low: number): Record<string, number> {
  const range = high - low;
  return {
    '0.0': low,
    '0.236': low + range * 0.236,
    '0.382': low + range * 0.382,
    '0.5': low + range * 0.5,
    '0.618': low + range * 0.618,
    '0.786': low + range * 0.786,
    '1.0': high,
    '1.272': low + range * 1.272,
    '1.618': low + range * 1.618,
    '2.0': low + range * 2.0,
    '2.618': low + range * 2.618
  };
}

/**
 * Check if value is within tolerance of target
 */
export function isNear(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= Math.abs(target) * tolerance;
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string = 'ta'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
