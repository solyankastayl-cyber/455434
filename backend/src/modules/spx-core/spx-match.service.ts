/**
 * SPX CORE — Match Service (Similarity Engine)
 * 
 * BLOCK B5.2.1 — Compute similarity between normalized series
 */

/**
 * Compute RMSE (Root Mean Square Error) between two series
 * Lower = more similar
 */
export function computeRMSE(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return Infinity;
  
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  
  return Math.sqrt(sum / n);
}

/**
 * Compute Pearson correlation between two series
 * Range: -1 to 1 (1 = perfect positive correlation)
 */
export function computeCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  
  const A = a.slice(0, n);
  const B = b.slice(0, n);
  
  const meanA = A.reduce((s, x) => s + x, 0) / n;
  const meanB = B.reduce((s, x) => s + x, 0) / n;
  
  let num = 0;
  let denA = 0;
  let denB = 0;
  
  for (let i = 0; i < n; i++) {
    const diffA = A[i] - meanA;
    const diffB = B[i] - meanB;
    num += diffA * diffB;
    denA += diffA * diffA;
    denB += diffB * diffB;
  }
  
  const den = Math.sqrt(denA * denB);
  if (den === 0) return 0;
  
  return num / den;
}

/**
 * Compute similarity score (0-100, higher = more similar)
 * Uses combination of RMSE and correlation
 */
export function computeSimilarity(a: number[], b: number[]): number {
  const rmse = computeRMSE(a, b);
  const corr = computeCorrelation(a, b);
  
  // RMSE component: convert to 0-100 (lower RMSE = higher score)
  // Typical normalized RMSE range is 0-0.3
  const rmseScore = Math.max(0, 100 - rmse * 300);
  
  // Correlation component: convert to 0-100
  const corrScore = (corr + 1) * 50;
  
  // Combined: 60% RMSE, 40% correlation
  const combined = rmseScore * 0.6 + corrScore * 0.4;
  
  return Math.max(0, Math.min(100, combined));
}

/**
 * Compute DTW-lite distance (simplified Dynamic Time Warping)
 * Allows for slight time shifts
 */
export function computeDTWLite(a: number[], b: number[], bandwidth: number = 2): number {
  const n = a.length;
  const m = b.length;
  
  if (n === 0 || m === 0) return Infinity;
  
  // Initialize cost matrix
  const dp: number[][] = Array(n).fill(null).map(() => 
    Array(m).fill(Infinity)
  );
  
  dp[0][0] = Math.abs(a[0] - b[0]);
  
  // Fill first row/column within bandwidth
  for (let i = 1; i < Math.min(bandwidth + 1, n); i++) {
    dp[i][0] = dp[i-1][0] + Math.abs(a[i] - b[0]);
  }
  for (let j = 1; j < Math.min(bandwidth + 1, m); j++) {
    dp[0][j] = dp[0][j-1] + Math.abs(a[0] - b[j]);
  }
  
  // Fill rest with bandwidth constraint
  for (let i = 1; i < n; i++) {
    for (let j = Math.max(1, i - bandwidth); j < Math.min(m, i + bandwidth + 1); j++) {
      const cost = Math.abs(a[i] - b[j]);
      dp[i][j] = cost + Math.min(
        dp[i-1][j],     // insertion
        dp[i][j-1],     // deletion
        dp[i-1][j-1]    // match
      );
    }
  }
  
  return dp[n-1][m-1];
}
