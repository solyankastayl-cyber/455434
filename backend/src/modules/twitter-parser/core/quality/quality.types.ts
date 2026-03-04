/**
 * Twitter Parser Module — Quality Types & Thresholds
 * 
 * Quality assessment logic.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY thresholds
 */

import type { QualityStatus } from '../../storage/types.js';

// Thresholds - FROZEN
export const QUALITY_THRESHOLDS = {
  EMPTY_STREAK_WARNING: 3,
  EMPTY_STREAK_DEGRADED: 5,
  EMPTY_STREAK_UNSTABLE: 10,
  SUCCESS_RATE_HEALTHY: 0.5,
  SUCCESS_RATE_DEGRADED: 0.3,
  SUCCESS_RATE_UNSTABLE: 0.1,
  MIN_RUNS_FOR_ASSESSMENT: 5,
  AVG_FETCHED_DECLINE_WARNING: 0.5,
  AVG_FETCHED_DECLINE_DEGRADED: 0.7,
};

// Score weights - FROZEN
export const SCORE_WEIGHTS = {
  SUCCESS_RATE: 40,
  EMPTY_STREAK: 30,
  AVG_FETCHED: 20,
  RECENCY: 10,
};

export interface QualityAssessment {
  status: QualityStatus;
  score: number;
  reasons: string[];
  recommendations: string[];
}

export interface QualityMetricsInput {
  runsTotal: number;
  runsWithResults: number;
  emptyStreak: number;
  avgFetched: number;
  lastNonEmptyAt: Date | null;
}

/**
 * Assess quality based on metrics
 */
export function assessQuality(metrics: QualityMetricsInput): QualityAssessment {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let score = 100;
  
  // Not enough data
  if (metrics.runsTotal < QUALITY_THRESHOLDS.MIN_RUNS_FOR_ASSESSMENT) {
    return {
      status: 'HEALTHY',
      score: 100,
      reasons: ['Insufficient data for assessment'],
      recommendations: ['Continue running to gather metrics'],
    };
  }
  
  // 1. Check empty streak
  if (metrics.emptyStreak >= QUALITY_THRESHOLDS.EMPTY_STREAK_UNSTABLE) {
    reasons.push(`Empty streak: ${metrics.emptyStreak} consecutive runs with no results`);
    recommendations.push('Consider checking target validity or reducing frequency');
    score -= 40;
  } else if (metrics.emptyStreak >= QUALITY_THRESHOLDS.EMPTY_STREAK_DEGRADED) {
    reasons.push(`Empty streak: ${metrics.emptyStreak} consecutive empty runs`);
    recommendations.push('Monitor target, may need frequency adjustment');
    score -= 25;
  } else if (metrics.emptyStreak >= QUALITY_THRESHOLDS.EMPTY_STREAK_WARNING) {
    reasons.push(`Warning: ${metrics.emptyStreak} consecutive empty runs`);
    score -= 10;
  }
  
  // 2. Check success rate
  const successRate = metrics.runsWithResults / metrics.runsTotal;
  
  if (successRate < QUALITY_THRESHOLDS.SUCCESS_RATE_UNSTABLE) {
    reasons.push(`Very low success rate: ${(successRate * 100).toFixed(1)}%`);
    recommendations.push('Target may be invalid or blocked');
    score -= 30;
  } else if (successRate < QUALITY_THRESHOLDS.SUCCESS_RATE_DEGRADED) {
    reasons.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
    recommendations.push('Consider reducing parsing frequency');
    score -= 20;
  } else if (successRate < QUALITY_THRESHOLDS.SUCCESS_RATE_HEALTHY) {
    reasons.push(`Below average success rate: ${(successRate * 100).toFixed(1)}%`);
    score -= 10;
  }
  
  // 3. Check avgFetched
  if (metrics.runsWithResults >= 3 && metrics.avgFetched < 2) {
    reasons.push(`Low average fetch count: ${metrics.avgFetched.toFixed(1)}`);
    recommendations.push('Target may have limited content');
    score -= 10;
  }
  
  // 4. Check recency
  if (metrics.lastNonEmptyAt) {
    const hoursSinceSuccess = (Date.now() - metrics.lastNonEmptyAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSuccess > 48) {
      reasons.push(`No results in ${Math.round(hoursSinceSuccess)} hours`);
      score -= 15;
    } else if (hoursSinceSuccess > 24) {
      reasons.push(`No results in ${Math.round(hoursSinceSuccess)} hours`);
      score -= 5;
    }
  }
  
  // Clamp score
  score = Math.max(0, Math.min(100, score));
  
  // Determine status
  let status: QualityStatus;
  if (score >= 70) {
    status = 'HEALTHY';
  } else if (score >= 40) {
    status = 'DEGRADED';
  } else {
    status = 'UNSTABLE';
  }
  
  if (status === 'HEALTHY' && recommendations.length === 0) {
    recommendations.push('No action needed');
  }
  
  return { status, score, reasons, recommendations };
}

/**
 * Check if target should reduce frequency
 */
export function shouldReduceFrequency(metrics: QualityMetricsInput): {
  reduce: boolean;
  factor: number;
  reason?: string;
} {
  if (metrics.runsTotal < QUALITY_THRESHOLDS.MIN_RUNS_FOR_ASSESSMENT) {
    return { reduce: false, factor: 1 };
  }
  
  if (metrics.emptyStreak >= QUALITY_THRESHOLDS.EMPTY_STREAK_DEGRADED) {
    return {
      reduce: true,
      factor: 0.5,
      reason: `Empty streak: ${metrics.emptyStreak}`,
    };
  }
  
  const successRate = metrics.runsWithResults / metrics.runsTotal;
  if (successRate < QUALITY_THRESHOLDS.SUCCESS_RATE_DEGRADED) {
    return {
      reduce: true,
      factor: 0.7,
      reason: `Low success rate: ${(successRate * 100).toFixed(1)}%`,
    };
  }
  
  const assessment = assessQuality(metrics);
  if (assessment.status === 'UNSTABLE') {
    return {
      reduce: true,
      factor: 0.3,
      reason: 'Quality unstable',
    };
  }
  
  return { reduce: false, factor: 1 };
}
