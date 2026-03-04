/**
 * Twitter Parser Module — Cooldown Service
 * 
 * Manages automatic cooldowns for accounts and targets.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY durations or thresholds
 */

// Cooldown durations (milliseconds)
export const COOLDOWN_DURATIONS = {
  RATE_LIMIT: 15 * 60 * 1000,        // 15 minutes
  ABORT_STORM: 30 * 60 * 1000,       // 30 minutes
  CONSECUTIVE_EMPTY: 10 * 60 * 1000, // 10 minutes
  CAPTCHA: 60 * 60 * 1000,           // 1 hour
};

// Thresholds for triggers
export const COOLDOWN_THRESHOLDS = {
  ABORT_COUNT: 3,           // 3 aborts in window
  ABORT_WINDOW_MS: 10 * 60 * 1000, // 10 minutes
  CONSECUTIVE_EMPTY: 5,     // 5 fetched=0 in a row
};

export interface CooldownInfo {
  isOnCooldown: boolean;
  cooldownUntil?: Date;
  cooldownReason?: string;
  remainingMs?: number;
}

/**
 * Abstract cooldown service interface.
 * 
 * This allows the module to define cooldown logic
 * while actual DB operations use the host's models.
 */
export interface ICooldownService {
  applyAccountCooldown(accountId: string, durationMs: number, reason: string): Promise<void>;
  applyTargetCooldown(targetId: string, durationMs: number, reason: string): Promise<void>;
  isAccountOnCooldown(accountId: string): Promise<CooldownInfo>;
  isTargetOnCooldown(targetId: string): Promise<CooldownInfo>;
  clearAccountCooldown(accountId: string): Promise<void>;
  clearTargetCooldown(targetId: string): Promise<void>;
  trackEmptyResult(targetId: string): Promise<boolean>;
  resetEmptyCount(targetId: string): Promise<void>;
}

/**
 * Calculate cooldown duration based on reason
 */
export function getCooldownDuration(reason: string): number {
  switch (reason) {
    case 'RATE_LIMIT':
    case 'RATE_LIMITED':
      return COOLDOWN_DURATIONS.RATE_LIMIT;
    case 'ABORT_STORM':
      return COOLDOWN_DURATIONS.ABORT_STORM;
    case 'CONSECUTIVE_EMPTY':
      return COOLDOWN_DURATIONS.CONSECUTIVE_EMPTY;
    case 'CAPTCHA':
      return COOLDOWN_DURATIONS.CAPTCHA;
    default:
      return COOLDOWN_DURATIONS.RATE_LIMIT;
  }
}

/**
 * Check if consecutive empty count triggers cooldown
 */
export function shouldTriggerCooldown(consecutiveEmptyCount: number): boolean {
  return consecutiveEmptyCount >= COOLDOWN_THRESHOLDS.CONSECUTIVE_EMPTY;
}
