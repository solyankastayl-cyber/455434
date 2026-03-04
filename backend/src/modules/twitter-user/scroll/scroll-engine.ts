/**
 * ScrollEngine - управление безопасным парсингом
 * 
 * НЕ решает что и когда парсить
 * Решает КАК безопасно выполнить задачу
 */

import { ScrollProfile, SCROLL_POLICIES, downgradeProfile, randomInRange } from './scroll-profiles.js';
import { ScrollRiskAssessor, type ScrollTelemetry, type RuntimeRisk, RiskLevel } from './scroll-risk.js';

/** Engine configuration */
export interface ScrollEngineConfig {
  targetId: string;
  ownerUserId: string;
  accountId: string;
  plannedPosts: number;
  initialProfile: ScrollProfile;
}

/** Engine state */
export interface ScrollEngineState {
  profile: ScrollProfile;
  fetchedPosts: number;
  scrolls: number;
  startedAt: Date;
  lastRisk: RuntimeRisk | null;
  aborted: boolean;
  downgrades: number;
}

/** Runtime hints for parser */
export interface RuntimeHints {
  scrollProfile: ScrollProfile;
  delayMs: number;
  scrollPx: number;
  batchSize: number;
  shouldStop: boolean;
  shouldDowngrade: boolean;
  reason?: string;
}

export class ScrollEngine {
  private config: ScrollEngineConfig;
  private state: ScrollEngineState;
  private riskAssessor: ScrollRiskAssessor;
  private telemetryHistory: ScrollTelemetry[] = [];

  constructor(config: ScrollEngineConfig) {
    this.config = config;
    this.riskAssessor = new ScrollRiskAssessor();
    
    this.state = {
      profile: config.initialProfile,
      fetchedPosts: 0,
      scrolls: 0,
      startedAt: new Date(),
      lastRisk: null,
      aborted: false,
      downgrades: 0,
    };
  }

  /**
   * Get current state
   */
  getState(): ScrollEngineState {
    return { ...this.state };
  }

  /**
   * Process telemetry and get next hints
   */
  processTelemetry(telemetry: ScrollTelemetry): RuntimeHints {
    // Store telemetry
    this.telemetryHistory.push(telemetry);
    this.state.fetchedPosts = telemetry.fetchedPosts;
    this.state.scrolls++;

    // Assess risk
    const risk = this.riskAssessor.assess(telemetry);
    this.state.lastRisk = risk;

    // Check abort condition
    if (this.riskAssessor.shouldAbort(risk)) {
      this.state.aborted = true;
      return this.buildHints(true, 'Risk level CRITICAL');
    }

    // Check downgrade condition
    if (this.riskAssessor.shouldDowngrade(risk)) {
      const nextProfile = downgradeProfile(this.state.profile);
      
      if (nextProfile) {
        this.state.profile = nextProfile;
        this.state.downgrades++;
        console.log(`[ScrollEngine] Downgraded to ${nextProfile} due to risk`);
      } else {
        // Already at SAFE, abort
        this.state.aborted = true;
        return this.buildHints(true, 'Cannot downgrade further, aborting');
      }
    }

    // Check completion
    if (this.state.fetchedPosts >= this.config.plannedPosts) {
      return this.buildHints(true, 'Target reached');
    }

    return this.buildHints(false);
  }

  /**
   * Build runtime hints
   */
  private buildHints(shouldStop: boolean, reason?: string): RuntimeHints {
    const policy = SCROLL_POLICIES[this.state.profile];

    return {
      scrollProfile: this.state.profile,
      delayMs: randomInRange(policy.minDelayMs, policy.maxDelayMs),
      scrollPx: randomInRange(policy.scrollPxMin, policy.scrollPxMax),
      batchSize: policy.batchSize,
      shouldStop,
      shouldDowngrade: this.state.lastRisk?.level === RiskLevel.HIGH,
      reason,
    };
  }

  /**
   * Get initial hints (before first scroll)
   */
  getInitialHints(): RuntimeHints {
    return this.buildHints(false);
  }

  /**
   * Check if engine should continue
   */
  shouldContinue(): boolean {
    return !this.state.aborted && this.state.fetchedPosts < this.config.plannedPosts;
  }

  /**
   * Get summary for logging/analytics
   */
  getSummary(): {
    config: ScrollEngineConfig;
    state: ScrollEngineState;
    telemetryCount: number;
    duration: number;
  } {
    return {
      config: this.config,
      state: this.state,
      telemetryCount: this.telemetryHistory.length,
      duration: Date.now() - this.state.startedAt.getTime(),
    };
  }
}

/**
 * AccountScrollMemory - per-account history for profile selection
 */
export interface AccountScrollMemory {
  accountId: string;
  lastProfile: ScrollProfile;
  lastAbortAt?: Date;
  avgLatency: number;
  totalScrolls: number;
  successRate: number;
}

/**
 * Determine initial profile based on account history
 */
export function selectInitialProfile(memory?: AccountScrollMemory): ScrollProfile {
  if (!memory) return ScrollProfile.SAFE;

  // If recently aborted, stay safe
  if (memory.lastAbortAt) {
    const hoursSinceAbort = (Date.now() - memory.lastAbortAt.getTime()) / 3600000;
    if (hoursSinceAbort < 6) return ScrollProfile.SAFE;
  }

  // If good success rate and normal latency, can try normal
  if (memory.successRate > 0.9 && memory.avgLatency < 2000) {
    return memory.lastProfile === ScrollProfile.AGGRESSIVE 
      ? ScrollProfile.NORMAL 
      : memory.lastProfile;
  }

  return ScrollProfile.SAFE;
}
