// P3 FREEZE Validation - Freeze Gate Service
// Evaluates metrics and returns APPROVED/BLOCKED verdict

import { MetricsSnapshot, metricsService } from './metrics.service.js';

export type FreezeVerdict = 'APPROVED' | 'BLOCKED';
export type LoadProfile = 'SMOKE' | 'STRESS' | 'SOAK';

export interface FreezeThresholds {
  maxErrorRate: number;       // e.g., 0.02 = 2%
  maxRetryRate: number;       // e.g., 0.05 = 5%
  maxCooldownRate: number;    // e.g., 0.03 = 3%
  maxRuntimeP95: number;      // ms, e.g., 2500
  maxMongoP95: number;        // ms, e.g., 150
  minSuccessRate: number;     // e.g., 0.95 = 95%
}

export interface FreezeResult {
  verdict: FreezeVerdict;
  reasons: string[];
  stats: MetricsSnapshot;
  profile: LoadProfile;
  durationMinutes: number;
  thresholds: FreezeThresholds;
  rates: {
    errorRate: number;
    retryRate: number;
    cooldownRate: number;
    successRate: number;
  };
  completedAt: number;
}

// Default thresholds for SMOKE profile
const SMOKE_THRESHOLDS: FreezeThresholds = {
  maxErrorRate: 0.05,       // 5%
  maxRetryRate: 0.10,       // 10%
  maxCooldownRate: 0.05,    // 5%
  maxRuntimeP95: 2500,      // 2.5s
  maxMongoP95: 150,         // 150ms
  minSuccessRate: 0.90,     // 90%
};

// Stricter thresholds for STRESS profile (realistic with fault injection)
const STRESS_THRESHOLDS: FreezeThresholds = {
  maxErrorRate: 0.02,       // 2%
  maxRetryRate: 0.08,       // 8% (accounts for 6% fault injection)
  maxCooldownRate: 0.05,    // 5% (accounts for rate limit handling)
  maxRuntimeP95: 2500,      // 2.5s
  maxMongoP95: 150,         // 150ms
  minSuccessRate: 0.95,     // 95%
};

export class FreezeGateService {
  private lastResult: FreezeResult | null = null;

  getThresholds(profile: LoadProfile): FreezeThresholds {
    switch (profile) {
      case 'SMOKE': return SMOKE_THRESHOLDS;
      case 'STRESS': return STRESS_THRESHOLDS;
      case 'SOAK': return STRESS_THRESHOLDS; // Same as stress
      default: return SMOKE_THRESHOLDS;
    }
  }

  evaluate(
    snapshot: MetricsSnapshot,
    profile: LoadProfile,
    durationMinutes: number
  ): FreezeResult {
    const thresholds = this.getThresholds(profile);
    const reasons: string[] = [];

    const { counters } = snapshot;
    const total = counters.tasksSucceeded + counters.tasksFailed;
    
    // Calculate rates
    const errorRate = total > 0 ? counters.tasksFailed / total : 0;
    const retryRate = total > 0 ? counters.tasksRetried / total : 0;
    const cooldownRate = counters.runtimeCalls > 0 
      ? counters.cooldownsTriggered / counters.runtimeCalls 
      : 0;
    const successRate = total > 0 ? counters.tasksSucceeded / total : 1;

    // Check thresholds
    if (errorRate > thresholds.maxErrorRate) {
      reasons.push(`Error rate ${(errorRate * 100).toFixed(1)}% > ${(thresholds.maxErrorRate * 100)}%`);
    }

    if (retryRate > thresholds.maxRetryRate) {
      reasons.push(`Retry rate ${(retryRate * 100).toFixed(1)}% > ${(thresholds.maxRetryRate * 100)}%`);
    }

    if (cooldownRate > thresholds.maxCooldownRate) {
      reasons.push(`Cooldown rate ${(cooldownRate * 100).toFixed(1)}% > ${(thresholds.maxCooldownRate * 100)}%`);
    }

    if (snapshot.latency.runtimeP95 > thresholds.maxRuntimeP95) {
      reasons.push(`Runtime P95 ${snapshot.latency.runtimeP95}ms > ${thresholds.maxRuntimeP95}ms`);
    }

    if (snapshot.latency.mongoP95 > thresholds.maxMongoP95) {
      reasons.push(`Mongo P95 ${snapshot.latency.mongoP95}ms > ${thresholds.maxMongoP95}ms`);
    }

    if (successRate < thresholds.minSuccessRate) {
      reasons.push(`Success rate ${(successRate * 100).toFixed(1)}% < ${(thresholds.minSuccessRate * 100)}%`);
    }

    // Check for data sufficiency
    if (total < 10) {
      reasons.push(`Insufficient data: only ${total} tasks completed`);
    }

    const verdict: FreezeVerdict = reasons.length === 0 ? 'APPROVED' : 'BLOCKED';

    const result: FreezeResult = {
      verdict,
      reasons,
      stats: snapshot,
      profile,
      durationMinutes,
      thresholds,
      rates: {
        errorRate,
        retryRate,
        cooldownRate,
        successRate,
      },
      completedAt: Date.now(),
    };

    this.lastResult = result;
    return result;
  }

  getLastResult(): FreezeResult | null {
    return this.lastResult;
  }
}

export const freezeGateService = new FreezeGateService();
