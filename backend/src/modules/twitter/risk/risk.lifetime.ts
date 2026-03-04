// P1: Lifetime Estimator
// Estimates remaining session lifetime based on risk score

export interface LifetimeEstimate {
  days: number;
  confidence: 'high' | 'medium' | 'low';
  description: string;
}

export class LifetimeEstimator {
  /**
   * Estimate remaining session lifetime in days
   * Based on risk score (0-100)
   */
  estimate(riskScore: number): number {
    // Handle NaN or invalid scores
    if (isNaN(riskScore) || riskScore === null || riskScore === undefined) {
      return 30; // Default to 30 days for unknown risk
    }
    
    // Clamp risk score to valid range
    const clampedScore = Math.max(0, Math.min(100, riskScore));
    
    // Simple linear model:
    // Risk 0 -> ~45 days
    // Risk 50 -> ~20 days  
    // Risk 100 -> ~3 days (minimum)
    const baseDays = 45;
    const reduction = clampedScore * 0.42; // ~42% reduction per point
    const days = Math.max(3, Math.round(baseDays - reduction));
    return Math.min(90, days); // Cap at 90 days
  }

  /**
   * Get detailed lifetime estimate with confidence
   */
  estimateDetailed(riskScore: number): LifetimeEstimate {
    const days = this.estimate(riskScore);
    
    let confidence: 'high' | 'medium' | 'low';
    let description: string;

    if (riskScore < 20) {
      confidence = 'high';
      description = 'Session is very healthy, expected to last several weeks';
    } else if (riskScore < 40) {
      confidence = 'high';
      description = 'Session is healthy, should last 2-3 weeks';
    } else if (riskScore < 60) {
      confidence = 'medium';
      description = 'Session showing some wear, recommend monitoring';
    } else if (riskScore < 80) {
      confidence = 'low';
      description = 'Session degrading, refresh recommended soon';
    } else {
      confidence = 'low';
      description = 'Session critical, refresh urgently needed';
    }

    return { days, confidence, description };
  }

  /**
   * Format lifetime for display
   */
  formatLifetime(days: number): string {
    if (days >= 30) {
      const weeks = Math.round(days / 7);
      return `~${weeks} weeks`;
    }
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      const remaining = days % 7;
      if (remaining > 0) {
        return `~${weeks}w ${remaining}d`;
      }
      return `~${weeks} weeks`;
    }
    return `~${days} days`;
  }
}

export const lifetimeEstimator = new LifetimeEstimator();
