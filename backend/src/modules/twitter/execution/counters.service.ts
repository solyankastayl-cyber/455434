// B2 Execution Core - Counters Service
// Tracks rate limits per slot

import { ParserInstance } from './types.js';

const HOUR_MS = 60 * 60 * 1000;

export class CountersService {
  /**
   * Increment usage counter for an instance
   * Handles window reset automatically
   */
  increment(instance: ParserInstance): void {
    this.resetIfNeeded(instance);
    instance.usedInWindow += 1;
  }

  /**
   * Reset window if hour has passed
   */
  resetIfNeeded(instance: ParserInstance): boolean {
    const now = Date.now();
    if (now - instance.windowStart > HOUR_MS) {
      instance.windowStart = now;
      instance.usedInWindow = 0;
      return true;
    }
    return false;
  }

  /**
   * Check if instance has remaining capacity
   */
  hasCapacity(instance: ParserInstance): boolean {
    this.resetIfNeeded(instance);
    return instance.usedInWindow < instance.limitPerHour;
  }

  /**
   * Get remaining capacity for instance
   */
  getRemainingCapacity(instance: ParserInstance): number {
    this.resetIfNeeded(instance);
    return Math.max(0, instance.limitPerHour - instance.usedInWindow);
  }

  /**
   * Get time until window reset (ms)
   */
  getTimeUntilReset(instance: ParserInstance): number {
    const elapsed = Date.now() - instance.windowStart;
    return Math.max(0, HOUR_MS - elapsed);
  }

  /**
   * Force reset window (for testing/admin)
   */
  forceReset(instance: ParserInstance): void {
    instance.windowStart = Date.now();
    instance.usedInWindow = 0;
  }
}

// Singleton export
export const countersService = new CountersService();
