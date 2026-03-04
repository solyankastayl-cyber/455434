// B2 Execution Core - Cooldown Service
// Handles cooldowns for instances after errors

import { ParserInstance } from './types.js';

// Cooldown durations in ms
const COOLDOWN_DURATIONS = {
  RATE_LIMIT: 60 * 1000,      // 1 minute for 429
  TIMEOUT: 30 * 1000,          // 30 seconds for timeout
  NETWORK_ERROR: 15 * 1000,    // 15 seconds for network errors
  UNKNOWN: 10 * 1000,          // 10 seconds for unknown errors
  DEFAULT: 15 * 60 * 1000,     // 15 minutes default
} as const;

export class CooldownService {
  /**
   * Apply cooldown based on error type
   */
  apply(instance: ParserInstance, error: any, minutes?: number): void {
    let duration: number;

    if (minutes !== undefined) {
      duration = minutes * 60 * 1000;
    } else {
      duration = this.getDurationForError(error);
    }

    instance.cooldownUntil = Date.now() + duration;
  }

  /**
   * Clear cooldown for instance
   */
  clear(instance: ParserInstance): void {
    instance.cooldownUntil = undefined;
  }

  /**
   * Check if instance is in cooldown
   */
  isInCooldown(instance: ParserInstance): boolean {
    if (!instance.cooldownUntil) return false;
    return instance.cooldownUntil > Date.now();
  }

  /**
   * Get remaining cooldown time (ms)
   */
  getRemainingCooldown(instance: ParserInstance): number {
    if (!instance.cooldownUntil) return 0;
    return Math.max(0, instance.cooldownUntil - Date.now());
  }

  /**
   * Determine cooldown duration based on error
   */
  private getDurationForError(error: any): number {
    // Check for rate limit (429)
    if (error?.status === 429 || error?.response?.status === 429) {
      return COOLDOWN_DURATIONS.RATE_LIMIT;
    }

    // Check for timeout
    if (error?.code === 'ECONNABORTED' || error?.code === 'TIMEOUT') {
      return COOLDOWN_DURATIONS.TIMEOUT;
    }

    // Check for network errors
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ENOTFOUND') {
      return COOLDOWN_DURATIONS.NETWORK_ERROR;
    }

    return COOLDOWN_DURATIONS.UNKNOWN;
  }
}

// Singleton export
export const cooldownService = new CooldownService();
