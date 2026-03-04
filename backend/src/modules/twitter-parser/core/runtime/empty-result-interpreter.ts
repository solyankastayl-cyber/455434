/**
 * Twitter Parser Module — Empty Result Interpreter
 * 
 * Smart fetched=0 handling.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY thresholds or classification logic
 */

import type { QualityStatus } from '../../storage/types.js';

export enum EmptyResultReason {
  EMPTY_OK = 'EMPTY_OK',
  EMPTY_SUSPICIOUS = 'EMPTY_SUSPICIOUS',
  EMPTY_BLOCKED = 'EMPTY_BLOCKED'
}

export interface EmptyEvaluationContext {
  responseTimeMs: number;
  httpStatus: number;
  hasStrangeHeaders?: boolean;
  targetType: 'KEYWORD' | 'ACCOUNT';
  isHighActivityTarget: boolean;
  metrics: {
    runsTotal: number;
    emptyStreak: number;
    avgFetched: number;
    lastNonEmptyAt: Date | null;
  } | null;
  previousFetchedCount: number;
  otherSessionsGettingResults: boolean;
}

export interface EmptyEvaluationResult {
  reason: EmptyResultReason;
  confidence: number;
  explanation: string;
  recommendations: string[];
}

// Thresholds - FROZEN
const THRESHOLDS = {
  FAST_RESPONSE_MS: 2000,
  SLOW_RESPONSE_MS: 10000,
  SUSPICIOUS_STREAK: 3,
  BLOCKED_STREAK: 7,
  LONG_DRY_SPELL_HOURS: 24,
  HIGH_ACTIVITY_AVG_FETCHED: 10,
};

export class EmptyResultInterpreter {
  
  static evaluate(context: EmptyEvaluationContext): EmptyEvaluationResult {
    const checks: Array<{
      reason: EmptyResultReason;
      score: number;
      explanation: string;
    }> = [];
    
    const { metrics, responseTimeMs, isHighActivityTarget, otherSessionsGettingResults } = context;
    
    // Check 1: No history or very few runs
    if (!metrics || metrics.runsTotal <= 2) {
      return {
        reason: EmptyResultReason.EMPTY_OK,
        confidence: 60,
        explanation: 'New target with insufficient history - empty result is normal',
        recommendations: ['Continue monitoring'],
      };
    }
    
    // Check 2: Empty streak
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
    
    // Check 3: Response time
    if (responseTimeMs < THRESHOLDS.FAST_RESPONSE_MS && emptyStreak > 1) {
      checks.push({
        reason: EmptyResultReason.EMPTY_SUSPICIOUS,
        score: 15,
        explanation: `Fast response (${responseTimeMs}ms) with empty result is unusual`,
      });
    }
    
    // Check 4: High activity target
    if (isHighActivityTarget && metrics.avgFetched > THRESHOLDS.HIGH_ACTIVITY_AVG_FETCHED) {
      if (emptyStreak > 1) {
        checks.push({
          reason: EmptyResultReason.EMPTY_SUSPICIOUS,
          score: 20,
          explanation: 'High-activity target (usually gets results) returning nothing',
        });
      }
    }
    
    // Check 5: Other sessions
    if (otherSessionsGettingResults && emptyStreak >= 2) {
      checks.push({
        reason: EmptyResultReason.EMPTY_BLOCKED,
        score: 30,
        explanation: 'Other sessions are getting results - this session may be throttled',
      });
    }
    
    // Check 6: Time since last success
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
    
    // Aggregate scores
    const blockedScore = checks
      .filter(c => c.reason === EmptyResultReason.EMPTY_BLOCKED)
      .reduce((sum, c) => sum + c.score, 0);
    
    const suspiciousScore = checks
      .filter(c => c.reason === EmptyResultReason.EMPTY_SUSPICIOUS)
      .reduce((sum, c) => sum + c.score, 0);
    
    // Determine final reason
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
    
    const recommendations = this.getRecommendations(finalReason);
    
    return {
      reason: finalReason,
      confidence: Math.round(confidence),
      explanation: explanations[0] || 'Empty result within normal parameters',
      recommendations,
    };
  }
  
  private static getRecommendations(reason: EmptyResultReason): string[] {
    switch (reason) {
      case EmptyResultReason.EMPTY_OK:
        return ['No action needed - empty result is normal', 'Target may have low activity'];
        
      case EmptyResultReason.EMPTY_SUSPICIOUS:
        return ['Consider reducing parsing frequency', 'Monitor for additional empty results', 'Try query diversification'];
        
      case EmptyResultReason.EMPTY_BLOCKED:
        return ['Reduce parsing frequency significantly', 'Consider session rotation', 'Check account status on Twitter', 'Wait 30-60 minutes before retry'];
        
      default:
        return ['Monitor target'];
    }
  }
  
  static getImpactScore(reason: EmptyResultReason): number {
    switch (reason) {
      case EmptyResultReason.EMPTY_OK: return 0;
      case EmptyResultReason.EMPTY_SUSPICIOUS: return 1;
      case EmptyResultReason.EMPTY_BLOCKED: return 3;
      default: return 0;
    }
  }
  
  static shouldTriggerCooldown(
    reason: EmptyResultReason,
    emptyStreak: number
  ): { trigger: boolean; durationMinutes: number; reason: string } {
    if (reason === EmptyResultReason.EMPTY_OK) {
      return { trigger: false, durationMinutes: 0, reason: '' };
    }
    
    if (reason === EmptyResultReason.EMPTY_SUSPICIOUS && emptyStreak >= 4) {
      return { trigger: true, durationMinutes: 15, reason: 'SUSPICIOUS_EMPTY_STREAK' };
    }
    
    if (reason === EmptyResultReason.EMPTY_BLOCKED) {
      return { trigger: true, durationMinutes: 60, reason: 'BLOCKED_EMPTY_PATTERN' };
    }
    
    return { trigger: false, durationMinutes: 0, reason: '' };
  }
}

export const emptyResultInterpreter = new EmptyResultInterpreter();
