/**
 * Shannon Entropy calculation for topology
 */

/**
 * Calculate normalized Shannon entropy from weight distribution
 * Returns 0..1 where:
 * - 0 = all weight concentrated in one element
 * - 1 = perfectly distributed across all elements
 */
export function entropyFromWeights(weights: number[]): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || weights.length < 2) return 0;

  const probs = weights.map(w => w / sum).filter(p => p > 0);
  
  // Shannon entropy: H = -Σ p_i * log(p_i)
  const H = -probs.reduce((acc, p) => acc + p * Math.log(p), 0);

  // Normalize by max entropy: log(n)
  const maxH = Math.log(probs.length);
  
  return maxH > 0 ? Math.min(1, H / maxH) : 0;
}

/**
 * Calculate Gini coefficient for inequality measurement
 * Returns 0..1 where:
 * - 0 = perfect equality
 * - 1 = maximum inequality
 */
export function giniCoefficient(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  if (sum === 0) return 0;

  let cumSum = 0;
  let giniSum = 0;

  for (let i = 0; i < n; i++) {
    cumSum += sorted[i];
    giniSum += cumSum;
  }

  // Gini = (2 * Σ(i * x_i) / (n * sum)) - (n + 1) / n
  const gini = (2 * giniSum) / (n * sum) - (n + 1) / n;
  
  return Math.max(0, Math.min(1, gini));
}

export default { entropyFromWeights, giniCoefficient };
