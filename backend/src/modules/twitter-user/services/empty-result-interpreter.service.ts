/**
 * Phase 7.3.1 — Empty Result Interpreter
 * 
 * Smart fetched=0 handling:
 * - EMPTY_OK: реально нет твитов (нормально)
 * - EMPTY_SUSPICIOUS: подозрительно (возможный throttling)
 * - EMPTY_BLOCKED: почти точно блок
 * 
 * НЕ ЛОМАЕТ CORE — только интерпретация результата.
 */

import { type IParserQualityMetrics, QualityStatus } from '../models/parser-quality-metrics.model.js';

export enum EmptyResultReason {
  EMPTY_OK = 'EMPTY_OK',                 // реально нет твитов
  EMPTY_SUSPICIOUS = 'EMPTY_SUSPICIOUS', // подозрительно (throttling)
  EMPTY_BLOCKED = 'EMPTY_BLOCKED'        // почти точно блок
}

export interface EmptyEvaluationContext {
  // Response metadata
  responseTimeMs: number;
  httpStatus: number;
  hasStrangeHeaders?: boolean;
  
  // Target context
  targetType: 'KEYWORD' | 'ACCOUNT';
  isHighActivityTarget: boolean;
  
  // History
  metrics: IParserQualityMetrics | null;
  previousFetchedCount: number;
  
  // Session context
  otherSessionsGettingResults: boolean;
}

export interface EmptyEvaluationResult {
  reason: EmptyResultReason;
  confidence: number;  // 0-100
  explanation: string;
  recommendations: string[];
}

// Thresholds
const THRESHOLDS = {
  // Response time thresholds (ms)
  FAST_RESPONSE_MS: 2000,        // < 2s = fast (suspicious if empty)
  SLOW_RESPONSE_MS: 10000,       // > 10s = slow (more likely real)
  
  // Empty streak thresholds
  SUSPICIOUS_STREAK: 3,          // >= 3 consecutive empty
  BLOCKED_STREAK: 7,             // >= 7 consecutive empty
  
  // Time since last success (hours)
  LONG_DRY_SPELL_HOURS: 24,      // No results in 24h+
  
  // High activity thresholds
  HIGH_ACTIVITY_AVG_FETCHED: 10, // avgFetched > 10 = high activity
};

export class EmptyResultInterpreter {
  
  /**
   * Evaluate why fetched=0 occurred
   */
  static evaluate(context: EmptyEvaluationContext): EmptyEvaluationResult {
    const checks: Array<{
      reason: EmptyResultReason;
      score: number;
      explanation: string;
    }> = [];
    
    const { metrics, responseTimeMs, isHighActivityTarget, otherSessionsGettingResults } = context;
    
    // === Check 1: No history or very few runs → likely OK ===
    if (!metrics || metrics.runsTotal <= 2) {
      return {
        reason: EmptyResultReason.EMPTY_OK,
        confidence: 60,
        explanation: 'New target with insufficient history - empty result is normal',
        recommendations: ['Continue monitoring'],
      };
    }
    
    // === Check 2: Empty streak ===
    const emptyStreak = metrics.emptyStreak;
    
    if (emptyStreak >= THRESHOLDS.BLOCKED_STREAK) {
      checks.push({
        reason: EmptyResultReason.EMPTY_BLOCKED,
        score: 40,
        explanation: `Very high empty streak (${emptyStreak}) suggests blocking`,
      });
    } else if (emptyStreak >= THRESHOLDS.SUSPICIOUS_STREAK) {
      checks.push({
        reason: EmptyResultReason.EMPTY_SUSPICIOUS,
        score: 25,
        explanation: `Elevated empty streak (${emptyStreak}) is concerning`,
      });
    }
    
    // === Check 3: Response time analysis ===
    if (responseTimeMs < THRESHOLDS.FAST_RESPONSE_MS && emptyStreak > 1) {
      // Very fast response + empty = suspicious (Twitter blocking quickly)
      checks.push({
        reason: EmptyResultReason.EMPTY_SUSPICIOUS,
        score: 15,
        explanation: `Fast response (${responseTimeMs}ms) with empty result is unusual`,
      });
    }
    
    // === Check 4: High activity target returning nothing ===
    if (isHighActivityTarget && metrics.avgFetched > THRESHOLDS.HIGH_ACTIVITY_AVG_FETCHED) {
      if (emptyStreak > 1) {
        checks.push({
          reason: EmptyResultReason.EMPTY_SUSPICIOUS,
          score: 20,
          explanation: 'High-activity target (usually gets results) returning nothing',
        });
      }
    }
    
    // === Check 5: Other sessions getting results but this one isn't ===
    if (otherSessionsGettingResults && emptyStreak >= 2) {
      checks.push({
        reason: EmptyResultReason.EMPTY_BLOCKED,
        score: 30,
        explanation: 'Other sessions are getting results - this session may be throttled',
      });
    }
    
    // === Check 6: Time since last success ===
    if (metrics.lastNonEmptyAt) {
      const hoursSinceSuccess = (Date.now() - new Date(metrics.lastNonEmptyAt).getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceSuccess > THRESHOLDS.LONG_DRY_SPELL_HOURS) {
        checks.push({
          reason: EmptyResultReason.EMPTY_BLOCKED,
          score: 25,
          explanation: `No results in ${Math.round(hoursSinceSuccess)} hours`,
        });
      }
    }
    
    // === Aggregate scores ===
    const blockedScore = checks
      .filter(c => c.reason === EmptyResultReason.EMPTY_BLOCKED)
      .reduce((sum, c) => sum + c.score, 0);
    
    const suspiciousScore = checks
      .filter(c => c.reason === EmptyResultReason.EMPTY_SUSPICIOUS)
      .reduce((sum, c) => sum + c.score, 0);
    
    // === Determine final reason ===
    let finalReason: EmptyResultReason;
    let confidence: number;
    let explanations: string[] = checks.map(c => c.explanation);
    
    if (blockedScore >= 50) {
      finalReason = EmptyResultReason.EMPTY_BLOCKED;
      confidence = Math.min(90, 50 + blockedScore);
    } else if (suspiciousScore >= 30 || blockedScore >= 25) {
      finalReason = EmptyResultReason.EMPTY_SUSPICIOUS;
      confidence = Math.min(80, 40 + suspiciousScore + blockedScore / 2);
    } else {
      finalReason = EmptyResultReason.EMPTY_OK;
      confidence = Math.max(50, 90 - suspiciousScore - blockedScore);
      explanations = ['Normal variance - target may have low current activity'];
    }
    
    // === Generate recommendations ===
    const recommendations = this.getRecommendations(finalReason, context);
    
    return {
      reason: finalReason,
      confidence: Math.round(confidence),
      explanation: explanations[0] || 'Empty result within normal parameters',
      recommendations,
    };
  }
  
  /**
   * Generate recommendations based on evaluation
   */
  private static getRecommendations(
    reason: EmptyResultReason,
    context: EmptyEvaluationContext
  ): string[] {
    switch (reason) {
      case EmptyResultReason.EMPTY_OK:
        return [
          'No action needed - empty result is normal',
          'Target may have low activity',
        ];
        
      case EmptyResultReason.EMPTY_SUSPICIOUS:
        return [
          'Consider reducing parsing frequency',
          'Monitor for additional empty results',
          'Try query diversification',
        ];
        
      case EmptyResultReason.EMPTY_BLOCKED:
        return [
          'Reduce parsing frequency significantly',
          'Consider session rotation',
          'Check account status on Twitter',
          'Wait 30-60 minutes before retry',
        ];
        
      default:
        return ['Monitor target'];
    }
  }
  
  /**
   * Calculate impact score for quality service
   * EMPTY_OK = 0 (no impact)
   * EMPTY_SUSPICIOUS = 1 (minor impact)
   * EMPTY_BLOCKED = 3 (significant impact)
   */
  static getImpactScore(reason: EmptyResultReason): number {
    switch (reason) {
      case EmptyResultReason.EMPTY_OK:
        return 0;
      case EmptyResultReason.EMPTY_SUSPICIOUS:
        return 1;
      case EmptyResultReason.EMPTY_BLOCKED:
        return 3;
      default:
        return 0;
    }
  }
  
  /**
   * Should this empty result trigger cooldown?
   */
  static shouldTriggerCooldown(
    reason: EmptyResultReason,
    metrics: IParserQualityMetrics | null
  ): { trigger: boolean; durationMinutes: number; reason: string } {
    // EMPTY_OK never triggers cooldown
    if (reason === EmptyResultReason.EMPTY_OK) {
      return { trigger: false, durationMinutes: 0, reason: '' };
    }
    
    // EMPTY_SUSPICIOUS: trigger short cooldown after streak
    if (reason === EmptyResultReason.EMPTY_SUSPICIOUS) {
      if (metrics && metrics.emptyStreak >= 4) {
        return {
          trigger: true,
          durationMinutes: 15,
          reason: 'SUSPICIOUS_EMPTY_STREAK',
        };
      }
      return { trigger: false, durationMinutes: 0, reason: '' };
    }
    
    // EMPTY_BLOCKED: trigger longer cooldown
    if (reason === EmptyResultReason.EMPTY_BLOCKED) {
      return {
        trigger: true,
        durationMinutes: 60,
        reason: 'BLOCKED_EMPTY_PATTERN',
      };
    }
    
    return { trigger: false, durationMinutes: 0, reason: '' };
  }
}

export const emptyResultInterpreter = new EmptyResultInterpreter();
