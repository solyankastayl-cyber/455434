/**
 * Phase R9: Smoothing Utilities
 * Bayesian shrinkage to prevent overfitting on small samples
 */

/**
 * Beta distribution posterior mean
 * Prior: Beta(alpha, beta)
 * Posterior after wins/losses: Beta(alpha+wins, beta+losses)
 */
export function betaMean(
  wins: number,
  losses: number,
  alpha = 2,
  beta = 2
): number {
  return (alpha + wins) / (alpha + beta + wins + losses);
}

/**
 * Shrink estimate toward prior based on sample size
 * With small n, result is closer to prior
 * With large n, result approaches observed p
 */
export function shrinkToPrior(
  p: number,
  n: number,
  strength = 30,
  prior = 0.5
): number {
  const w = n / (n + strength);
  return prior * (1 - w) + p * w;
}

/**
 * Empirical Bayes estimate
 * Combines observed rate with prior using pseudo-counts
 */
export function empiricalBayes(
  wins: number,
  total: number,
  priorWins = 2,
  priorTotal = 4
): number {
  return (wins + priorWins) / (total + priorTotal);
}

/**
 * Wilson score interval lower bound
 * Gives conservative estimate for small samples
 */
export function wilsonLower(
  wins: number,
  total: number,
  z = 1.96 // 95% confidence
): number {
  if (total === 0) return 0;
  
  const p = wins / total;
  const denom = 1 + z * z / total;
  const center = p + z * z / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  
  return Math.max(0, (center - spread) / denom);
}
