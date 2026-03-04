/**
 * Twitter Parser Module — Timing Strategy
 * 
 * Human-like delays and timing patterns.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY profiles or timing calculations
 */

export type TimingProfile = 'AGGRESSIVE' | 'NORMAL' | 'CAUTIOUS' | 'RECOVERY';

export interface TimingConfig {
  profile: TimingProfile;
  minDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
  interRequestDelayMs: number;
  batchCooldownMs: number;
  maxRpm: number;
}

// Profile configurations - FROZEN
const TIMING_PROFILES: Record<TimingProfile, TimingConfig> = {
  AGGRESSIVE: {
    profile: 'AGGRESSIVE',
    minDelayMs: 1000,
    maxDelayMs: 3000,
    jitterFactor: 0.2,
    interRequestDelayMs: 500,
    batchCooldownMs: 5000,
    maxRpm: 30,
  },
  NORMAL: {
    profile: 'NORMAL',
    minDelayMs: 2000,
    maxDelayMs: 5000,
    jitterFactor: 0.3,
    interRequestDelayMs: 1000,
    batchCooldownMs: 10000,
    maxRpm: 20,
  },
  CAUTIOUS: {
    profile: 'CAUTIOUS',
    minDelayMs: 5000,
    maxDelayMs: 15000,
    jitterFactor: 0.4,
    interRequestDelayMs: 3000,
    batchCooldownMs: 30000,
    maxRpm: 10,
  },
  RECOVERY: {
    profile: 'RECOVERY',
    minDelayMs: 15000,
    maxDelayMs: 60000,
    jitterFactor: 0.5,
    interRequestDelayMs: 10000,
    batchCooldownMs: 120000,
    maxRpm: 4,
  },
};

export interface TimingContext {
  qualityStatus: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
  emptyStreak: number;
  scope: 'SYSTEM' | 'USER';
  recentErrorCount: number;
  lastRequestTimeMs?: number;
  hourOfDay: number;
}

export interface DelayResult {
  delayMs: number;
  profile: TimingProfile;
  reason: string;
  nextAllowedTime: Date;
}

export class TimingStrategy {
  
  static selectProfile(context: TimingContext): TimingProfile {
    const { qualityStatus, emptyStreak, scope, recentErrorCount } = context;
    
    if (qualityStatus === 'UNSTABLE' || recentErrorCount >= 5) {
      return 'RECOVERY';
    }
    
    if (qualityStatus === 'DEGRADED' || emptyStreak >= 5 || recentErrorCount >= 2) {
      return 'CAUTIOUS';
    }
    
    if (scope === 'SYSTEM') {
      return 'NORMAL';
    }
    
    if (qualityStatus === 'HEALTHY' && emptyStreak < 2) {
      return 'AGGRESSIVE';
    }
    
    return 'NORMAL';
  }
  
  static calculateDelay(context: TimingContext): DelayResult {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    
    const baseDelay = this.randomInRange(config.minDelayMs, config.maxDelayMs);
    const jitter = this.applyJitter(baseDelay, config.jitterFactor);
    const todModifier = this.getTimeOfDayModifier(context.hourOfDay);
    const errorBackoff = this.getErrorBackoff(context.recentErrorCount);
    
    let finalDelay = Math.round(jitter * todModifier * errorBackoff);
    finalDelay = Math.max(config.minDelayMs, Math.min(finalDelay, config.maxDelayMs * 2));
    
    return {
      delayMs: finalDelay,
      profile,
      reason: this.getDelayReason(profile, context),
      nextAllowedTime: new Date(Date.now() + finalDelay),
    };
  }
  
  static calculateInterRequestDelay(context: TimingContext): number {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    return this.applyJitter(config.interRequestDelayMs, config.jitterFactor);
  }
  
  static calculateBatchCooldown(context: TimingContext): number {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    return this.applyJitter(config.batchCooldownMs, config.jitterFactor * 2);
  }
  
  static getMaxRpm(context: TimingContext): number {
    const profile = this.selectProfile(context);
    return TIMING_PROFILES[profile].maxRpm;
  }
  
  private static randomInRange(min: number, max: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mid = (min + max) / 2;
    const stdDev = (max - min) / 4;
    const value = mid + z * stdDev;
    return Math.max(min, Math.min(max, value));
  }
  
  private static applyJitter(base: number, factor: number): number {
    const jitterRange = base * factor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.round(base + jitter);
  }
  
  private static getTimeOfDayModifier(hour: number): number {
    if ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16)) {
      return 1.5;
    }
    if (hour >= 0 && hour <= 6) {
      return 0.8;
    }
    return 1.0;
  }
  
  private static getErrorBackoff(errorCount: number): number {
    if (errorCount === 0) return 1.0;
    if (errorCount === 1) return 1.5;
    if (errorCount === 2) return 2.0;
    if (errorCount <= 4) return 3.0;
    return 5.0;
  }
  
  private static getDelayReason(profile: TimingProfile, context: TimingContext): string {
    switch (profile) {
      case 'AGGRESSIVE':
        return 'Healthy target, minimal delays';
      case 'NORMAL':
        return 'Standard timing for reliable parsing';
      case 'CAUTIOUS':
        return `Elevated caution due to ${context.qualityStatus} status`;
      case 'RECOVERY':
        return `Recovery mode: high error rate or unstable target`;
      default:
        return 'Standard timing';
    }
  }
  
  static async sleep(context: TimingContext): Promise<void> {
    const result = this.calculateDelay(context);
    console.log(`[TimingStrategy] Sleeping ${result.delayMs}ms (${result.profile}): ${result.reason}`);
    return new Promise(resolve => setTimeout(resolve, result.delayMs));
  }
  
  static shouldThrottle(
    requestsInLastMinute: number,
    context: TimingContext
  ): { throttle: boolean; waitMs: number } {
    const maxRpm = this.getMaxRpm(context);
    
    if (requestsInLastMinute >= maxRpm) {
      const waitMs = (60 - (Date.now() % 60000) / 1000) * 1000 + Math.random() * 5000;
      return { throttle: true, waitMs: Math.round(waitMs) };
    }
    
    return { throttle: false, waitMs: 0 };
  }
}

export const timingStrategy = new TimingStrategy();
