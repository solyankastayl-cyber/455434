/**
 * Phase 7.3.3 — Adaptive Timing Strategy
 * 
 * Human-like delays and timing patterns.
 * Different profiles for different quality states.
 * Jitter instead of fixed delays.
 * 
 * НЕ ЛОМАЕТ CORE — только расчёт задержек.
 */

export type TimingProfile = 'AGGRESSIVE' | 'NORMAL' | 'CAUTIOUS' | 'RECOVERY';

export interface TimingConfig {
  profile: TimingProfile;
  
  // Base delays (ms)
  minDelayMs: number;
  maxDelayMs: number;
  
  // Jitter range (0-1)
  jitterFactor: number;
  
  // Between-request delays
  interRequestDelayMs: number;
  
  // Cool-off after batch
  batchCooldownMs: number;
  
  // Max requests per minute
  maxRpm: number;
}

// Profile configurations
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
  // Quality state
  qualityStatus: 'HEALTHY' | 'DEGRADED' | 'UNSTABLE';
  emptyStreak: number;
  
  // Scope
  scope: 'SYSTEM' | 'USER';
  
  // Recent history
  recentErrorCount: number;
  lastRequestTimeMs?: number;
  
  // Time of day (0-23)
  hourOfDay: number;
}

export interface DelayResult {
  delayMs: number;
  profile: TimingProfile;
  reason: string;
  nextAllowedTime: Date;
}

export class TimingStrategy {
  
  /**
   * Select timing profile based on context
   */
  static selectProfile(context: TimingContext): TimingProfile {
    const { qualityStatus, emptyStreak, scope, recentErrorCount } = context;
    
    // RECOVERY: unstable or high error rate
    if (qualityStatus === 'UNSTABLE' || recentErrorCount >= 5) {
      return 'RECOVERY';
    }
    
    // CAUTIOUS: degraded or moderate empty streak
    if (qualityStatus === 'DEGRADED' || emptyStreak >= 5 || recentErrorCount >= 2) {
      return 'CAUTIOUS';
    }
    
    // SYSTEM scope is always at least NORMAL
    if (scope === 'SYSTEM') {
      return 'NORMAL';
    }
    
    // USER scope with good health → can be more aggressive
    if (qualityStatus === 'HEALTHY' && emptyStreak < 2) {
      return 'AGGRESSIVE';
    }
    
    return 'NORMAL';
  }
  
  /**
   * Calculate delay for next request
   */
  static calculateDelay(context: TimingContext): DelayResult {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    
    // Base delay with jitter
    const baseDelay = this.randomInRange(config.minDelayMs, config.maxDelayMs);
    const jitter = this.applyJitter(baseDelay, config.jitterFactor);
    
    // Time-of-day modifier (slower during peak hours)
    const todModifier = this.getTimeOfDayModifier(context.hourOfDay);
    
    // Error backoff
    const errorBackoff = this.getErrorBackoff(context.recentErrorCount);
    
    // Calculate final delay
    let finalDelay = Math.round(jitter * todModifier * errorBackoff);
    
    // Clamp to reasonable bounds
    finalDelay = Math.max(config.minDelayMs, Math.min(finalDelay, config.maxDelayMs * 2));
    
    return {
      delayMs: finalDelay,
      profile,
      reason: this.getDelayReason(profile, context),
      nextAllowedTime: new Date(Date.now() + finalDelay),
    };
  }
  
  /**
   * Calculate inter-request delay (within same batch)
   */
  static calculateInterRequestDelay(context: TimingContext): number {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    
    // Add jitter to inter-request delay
    return this.applyJitter(config.interRequestDelayMs, config.jitterFactor);
  }
  
  /**
   * Calculate batch cooldown (after completing a batch of requests)
   */
  static calculateBatchCooldown(context: TimingContext): number {
    const profile = this.selectProfile(context);
    const config = TIMING_PROFILES[profile];
    
    // Add jitter
    const base = config.batchCooldownMs;
    return this.applyJitter(base, config.jitterFactor * 2); // More jitter for batch cooldown
  }
  
  /**
   * Get max requests per minute for profile
   */
  static getMaxRpm(context: TimingContext): number {
    const profile = this.selectProfile(context);
    return TIMING_PROFILES[profile].maxRpm;
  }
  
  /**
   * Human-like random delay (not uniform distribution)
   * Uses normal-ish distribution clustered around midpoint
   */
  private static randomInRange(min: number, max: number): number {
    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    
    // Map to range (center at midpoint, std dev = range/4)
    const mid = (min + max) / 2;
    const stdDev = (max - min) / 4;
    const value = mid + z * stdDev;
    
    // Clamp to bounds
    return Math.max(min, Math.min(max, value));
  }
  
  /**
   * Apply jitter to a base value
   */
  private static applyJitter(base: number, factor: number): number {
    const jitterRange = base * factor;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    return Math.round(base + jitter);
  }
  
  /**
   * Time-of-day modifier (slower during peak hours)
   * Peak hours (US times): 9-11 AM, 2-4 PM EST
   */
  private static getTimeOfDayModifier(hour: number): number {
    // Peak hours = slower (1.5x delay)
    // Off-peak = normal (1.0x)
    // Night = faster (0.8x)
    
    // Peak hours (9-11, 14-16)
    if ((hour >= 9 && hour <= 11) || (hour >= 14 && hour <= 16)) {
      return 1.5;
    }
    
    // Night hours (0-6)
    if (hour >= 0 && hour <= 6) {
      return 0.8;
    }
    
    return 1.0;
  }
  
  /**
   * Error backoff multiplier
   */
  private static getErrorBackoff(errorCount: number): number {
    if (errorCount === 0) return 1.0;
    if (errorCount === 1) return 1.5;
    if (errorCount === 2) return 2.0;
    if (errorCount <= 4) return 3.0;
    return 5.0; // Max backoff
  }
  
  /**
   * Get human-readable delay reason
   */
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
  
  /**
   * Create a sleep promise with the calculated delay
   */
  static async sleep(context: TimingContext): Promise<void> {
    const result = this.calculateDelay(context);
    console.log(`[TimingStrategy] Sleeping ${result.delayMs}ms (${result.profile}): ${result.reason}`);
    return new Promise(resolve => setTimeout(resolve, result.delayMs));
  }
  
  /**
   * Check if we should throttle based on RPM
   */
  static shouldThrottle(
    requestsInLastMinute: number,
    context: TimingContext
  ): { throttle: boolean; waitMs: number } {
    const maxRpm = this.getMaxRpm(context);
    
    if (requestsInLastMinute >= maxRpm) {
      // Wait until the minute resets plus some jitter
      const waitMs = (60 - (Date.now() % 60000) / 1000) * 1000 + Math.random() * 5000;
      return { throttle: true, waitMs: Math.round(waitMs) };
    }
    
    return { throttle: false, waitMs: 0 };
  }
}

export const timingStrategy = new TimingStrategy();
