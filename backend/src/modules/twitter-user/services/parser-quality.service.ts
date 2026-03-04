/**
 * Phase 5.3 + Phase 7.3.1 — Parser Quality Service
 * 
 * Tracks and analyzes parser quality metrics.
 * Determines quality status based on objective data.
 * 
 * Phase 7.3.1 adds:
 * - Smart empty result interpretation (EMPTY_OK/SUSPICIOUS/BLOCKED)
 * - Impact scoring for different empty types
 * 
 * RULES:
 * - No guessing - only objective metrics
 * - fetched=0 is data, not automatic failure
 * - Quality degrades gradually, not suddenly
 * - Different empty reasons have different impacts
 */

import { 
  ParserQualityMetricsModel, 
  QualityStatus,
  type IParserQualityMetrics,
} from '../models/parser-quality-metrics.model.js';
import { 
  EmptyResultInterpreter, 
  EmptyResultReason,
  type EmptyEvaluationContext,
  type EmptyEvaluationResult,
} from './empty-result-interpreter.service.js';

// Thresholds for quality assessment
export const QUALITY_THRESHOLDS = {
  // Empty streak thresholds
  EMPTY_STREAK_WARNING: 3,      // emptyStreak >= 3 → warning
  EMPTY_STREAK_DEGRADED: 5,     // emptyStreak >= 5 → DEGRADED
  EMPTY_STREAK_UNSTABLE: 10,    // emptyStreak >= 10 → UNSTABLE
  
  // Success rate thresholds (runsWithResults / runsTotal)
  SUCCESS_RATE_HEALTHY: 0.5,    // >= 50% → HEALTHY
  SUCCESS_RATE_DEGRADED: 0.3,   // >= 30% → DEGRADED
  SUCCESS_RATE_UNSTABLE: 0.1,   // >= 10% → UNSTABLE (below = very bad)
  
  // Minimum runs for assessment
  MIN_RUNS_FOR_ASSESSMENT: 5,   // Need at least 5 runs to assess
  
  // avgFetched decline thresholds
  AVG_FETCHED_DECLINE_WARNING: 0.5,  // 50% decline → warning
  AVG_FETCHED_DECLINE_DEGRADED: 0.7, // 70% decline → DEGRADED
};

// Quality score calculation weights
const SCORE_WEIGHTS = {
  SUCCESS_RATE: 40,       // 40% of score
  EMPTY_STREAK: 30,       // 30% of score
  AVG_FETCHED: 20,        // 20% of score
  RECENCY: 10,            // 10% of score
};

export interface QualityAssessment {
  status: QualityStatus;
  score: number;
  reasons: string[];
  recommendations: string[];
}

export interface RecordRunInput {
  targetId: string;
  accountId: string;
  ownerUserId: string;
  fetched: number;
  durationMs?: number;
  // Phase 7.3.1: Additional context for empty result interpretation
  responseTimeMs?: number;
  targetType?: 'KEYWORD' | 'ACCOUNT';
  isHighActivityTarget?: boolean;
}

class ParserQualityService {
  
  /**
   * Record a parsing run result
   * Updates metrics and reassesses quality
   * Phase 7.3.1: Includes smart empty result interpretation
   */
  async recordRun(input: RecordRunInput): Promise<QualityAssessment & { emptyInterpretation?: EmptyEvaluationResult }> {
    const { targetId, accountId, ownerUserId, fetched, responseTimeMs, targetType, isHighActivityTarget } = input;
    
    // Get or create metrics document
    let metrics = await ParserQualityMetricsModel.findOne({
      targetId,
      accountId,
    });
    
    const isNew = !metrics;
    const now = new Date();
    
    if (!metrics) {
      metrics = new ParserQualityMetricsModel({
        targetId,
        accountId,
        ownerUserId,
        firstRunAt: now,
        lastRunAt: now,
      });
    }
    
    // Update run statistics
    metrics.runsTotal += 1;
    metrics.lastRunAt = now;
    
    if (fetched > 0) {
      // Successful run
      metrics.runsWithResults += 1;
      metrics.totalFetched += fetched;
      metrics.emptyStreak = 0;
      metrics.lastNonEmptyAt = now;
      
      // Update min/max
      if (fetched > metrics.maxFetched) metrics.maxFetched = fetched;
      if (fetched < metrics.minFetched || metrics.minFetched === Infinity) {
        metrics.minFetched = fetched;
      }
    } else {
      // Empty run - Phase 7.3.1: Smart interpretation
      metrics.runsEmpty += 1;
      metrics.emptyStreak += 1;
      
      if (metrics.emptyStreak > metrics.maxEmptyStreak) {
        metrics.maxEmptyStreak = metrics.emptyStreak;
      }
    }
    
    // Phase 7.3.1: Interpret empty result if fetched=0
    let emptyInterpretation: EmptyEvaluationResult | undefined;
    
    if (fetched === 0 && !isNew) {
      const evalContext: EmptyEvaluationContext = {
        responseTimeMs: responseTimeMs || 5000,
        httpStatus: 200,
        targetType: targetType || 'KEYWORD',
        isHighActivityTarget: isHighActivityTarget || (metrics.avgFetched > 10),
        metrics,
        previousFetchedCount: metrics.runsWithResults > 0 ? metrics.avgFetched : 0,
        otherSessionsGettingResults: false, // TODO: cross-session check
      };
      
      emptyInterpretation = EmptyResultInterpreter.evaluate(evalContext);
      
      // Apply impact score to metrics
      const impactScore = EmptyResultInterpreter.getImpactScore(emptyInterpretation.reason);
      
      // Log interpretation
      console.log(`[ParserQuality] Empty result for ${targetId}: ${emptyInterpretation.reason} (confidence: ${emptyInterpretation.confidence}%, impact: ${impactScore})`);
      
      // Check if should trigger cooldown
      const cooldownCheck = EmptyResultInterpreter.shouldTriggerCooldown(emptyInterpretation.reason, metrics);
      if (cooldownCheck.trigger) {
        console.log(`[ParserQuality] Triggering ${cooldownCheck.durationMinutes}min cooldown for ${targetId}: ${cooldownCheck.reason}`);
        // Note: Actual cooldown is handled by cooldownService, we just log here
      }
    }
    
    // Recalculate average
    if (metrics.runsWithResults > 0) {
      metrics.avgFetched = metrics.totalFetched / metrics.runsWithResults;
    }
    
    // Assess quality
    const assessment = this.assessQuality(metrics);
    
    // Update quality fields
    metrics.qualityStatus = assessment.status;
    metrics.qualityScore = assessment.score;
    metrics.lastAssessedAt = now;
    
    // Track degradation
    if (assessment.status !== QualityStatus.HEALTHY && !metrics.degradedSince) {
      metrics.degradedSince = now;
      metrics.degradationReason = assessment.reasons[0] || 'Unknown';
    } else if (assessment.status === QualityStatus.HEALTHY) {
      metrics.degradedSince = null;
      metrics.degradationReason = null;
    }
    
    await metrics.save();
    
    // Log quality changes
    if (!isNew) {
      this.logQualityStatus(targetId, assessment);
    }
    
    return { ...assessment, emptyInterpretation };
  }
  
  /**
   * Assess quality based on metrics
   */
  assessQuality(metrics: IParserQualityMetrics): QualityAssessment {
    const reasons: string[] = [];
    const recommendations: string[] = [];
    let score = 100;
    
    // Not enough data for assessment
    if (metrics.runsTotal < QUALITY_THRESHOLDS.MIN_RUNS_FOR_ASSESSMENT) {
      return {
        status: QualityStatus.HEALTHY,
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
    
    // 3. Check avgFetched trend (if we have history)
    if (metrics.runsWithResults >= 3 && metrics.avgFetched < 2) {
      reasons.push(`Low average fetch count: ${metrics.avgFetched.toFixed(1)}`);
      recommendations.push('Target may have limited content');
      score -= 10;
    }
    
    // 4. Check recency (last successful fetch)
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
    
    // Determine status from score
    let status: QualityStatus;
    if (score >= 70) {
      status = QualityStatus.HEALTHY;
    } else if (score >= 40) {
      status = QualityStatus.DEGRADED;
    } else {
      status = QualityStatus.UNSTABLE;
    }
    
    // Add default recommendation if healthy
    if (status === QualityStatus.HEALTHY && recommendations.length === 0) {
      recommendations.push('No action needed');
    }
    
    return { status, score, reasons, recommendations };
  }
  
  /**
   * Get quality metrics for a target
   */
  async getMetrics(targetId: string, accountId?: string): Promise<IParserQualityMetrics | null> {
    const filter: any = { targetId };
    if (accountId) filter.accountId = accountId;
    
    return ParserQualityMetricsModel.findOne(filter).lean();
  }
  
  /**
   * Get all metrics for a user
   */
  async getUserMetrics(ownerUserId: string): Promise<IParserQualityMetrics[]> {
    return ParserQualityMetricsModel.find({ ownerUserId })
      .sort({ lastRunAt: -1 })
      .lean();
  }
  
  /**
   * Get degraded/unstable targets
   */
  async getDegradedTargets(ownerUserId?: string): Promise<IParserQualityMetrics[]> {
    const filter: any = {
      qualityStatus: { $in: [QualityStatus.DEGRADED, QualityStatus.UNSTABLE] },
    };
    if (ownerUserId) filter.ownerUserId = ownerUserId;
    
    return ParserQualityMetricsModel.find(filter)
      .sort({ qualityScore: 1 })
      .lean();
  }
  
  /**
   * Get quality summary for admin
   */
  async getQualitySummary(): Promise<{
    total: number;
    healthy: number;
    degraded: number;
    unstable: number;
    avgScore: number;
  }> {
    const stats = await ParserQualityMetricsModel.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          healthy: { $sum: { $cond: [{ $eq: ['$qualityStatus', QualityStatus.HEALTHY] }, 1, 0] } },
          degraded: { $sum: { $cond: [{ $eq: ['$qualityStatus', QualityStatus.DEGRADED] }, 1, 0] } },
          unstable: { $sum: { $cond: [{ $eq: ['$qualityStatus', QualityStatus.UNSTABLE] }, 1, 0] } },
          avgScore: { $avg: '$qualityScore' },
        },
      },
    ]);
    
    if (stats.length === 0) {
      return { total: 0, healthy: 0, degraded: 0, unstable: 0, avgScore: 100 };
    }
    
    return {
      total: stats[0].total,
      healthy: stats[0].healthy,
      degraded: stats[0].degraded,
      unstable: stats[0].unstable,
      avgScore: Math.round(stats[0].avgScore || 100),
    };
  }
  
  /**
   * Check if target should reduce frequency (anti-block)
   */
  shouldReduceFrequency(metrics: IParserQualityMetrics): {
    reduce: boolean;
    factor: number;
    reason?: string;
  } {
    // Not enough data
    if (metrics.runsTotal < QUALITY_THRESHOLDS.MIN_RUNS_FOR_ASSESSMENT) {
      return { reduce: false, factor: 1 };
    }
    
    // High empty streak → reduce frequency
    if (metrics.emptyStreak >= QUALITY_THRESHOLDS.EMPTY_STREAK_DEGRADED) {
      return {
        reduce: true,
        factor: 0.5, // Half the frequency
        reason: `Empty streak: ${metrics.emptyStreak}`,
      };
    }
    
    // Low success rate → reduce frequency
    const successRate = metrics.runsWithResults / metrics.runsTotal;
    if (successRate < QUALITY_THRESHOLDS.SUCCESS_RATE_DEGRADED) {
      return {
        reduce: true,
        factor: 0.7, // 70% of normal frequency
        reason: `Low success rate: ${(successRate * 100).toFixed(1)}%`,
      };
    }
    
    // Unstable → significantly reduce
    if (metrics.qualityStatus === QualityStatus.UNSTABLE) {
      return {
        reduce: true,
        factor: 0.3, // 30% of normal frequency
        reason: 'Quality unstable',
      };
    }
    
    return { reduce: false, factor: 1 };
  }
  
  /**
   * Log quality status changes
   */
  private logQualityStatus(targetId: string, assessment: QualityAssessment): void {
    const emoji = assessment.status === QualityStatus.HEALTHY ? '🟢' :
                  assessment.status === QualityStatus.DEGRADED ? '🟠' : '🔴';
    
    console.log(`[ParserQuality] ${emoji} Target ${targetId} | status: ${assessment.status} | score: ${assessment.score}`);
    
    if (assessment.reasons.length > 0) {
      console.log(`[ParserQuality]   Reasons: ${assessment.reasons.join(', ')}`);
    }
  }
  
  /**
   * Interpret empty result
   * Returns context about why fetched=0 might have occurred
   */
  interpretEmptyResult(metrics: IParserQualityMetrics): {
    severity: 'normal' | 'warning' | 'concerning';
    interpretation: string;
  } {
    // First run or very few runs → normal
    if (metrics.runsTotal <= 2) {
      return {
        severity: 'normal',
        interpretation: 'New target, insufficient data',
      };
    }
    
    // Low empty streak → normal variance
    if (metrics.emptyStreak < QUALITY_THRESHOLDS.EMPTY_STREAK_WARNING) {
      return {
        severity: 'normal',
        interpretation: 'Normal variance, target may have low activity',
      };
    }
    
    // Medium empty streak → warning
    if (metrics.emptyStreak < QUALITY_THRESHOLDS.EMPTY_STREAK_DEGRADED) {
      return {
        severity: 'warning',
        interpretation: `Empty streak ${metrics.emptyStreak}: monitor target`,
      };
    }
    
    // High empty streak → concerning
    return {
      severity: 'concerning',
      interpretation: `Empty streak ${metrics.emptyStreak}: target may be invalid or rate-limited`,
    };
  }
}

// Singleton instance
export const parserQualityService = new ParserQualityService();
