// B2 Execution Core - Slot Selector
// Selects the best available ParserInstance for execution

import { ParserInstance } from './types.js';

export class SlotSelector {
  /**
   * Select the best available slot using least-used strategy
   * @param instances - Available parser instances from B1
   * @returns Selected instance or null if none available
   */
  select(instances: ParserInstance[]): ParserInstance | null {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Filter available instances
    const available = instances.filter(instance => {
      // Must be enabled
      if (!instance.enabled) return false;

      // Reset window if hour has passed
      if (now - instance.windowStart > hourMs) {
        instance.windowStart = now;
        instance.usedInWindow = 0;
      }

      // Must have capacity
      if (instance.usedInWindow >= instance.limitPerHour) return false;

      // Must not be in cooldown
      if (instance.cooldownUntil && instance.cooldownUntil > now) return false;

      return true;
    });

    if (available.length === 0) return null;

    // Sort by usedInWindow ascending (least-used first)
    available.sort((a, b) => a.usedInWindow - b.usedInWindow);

    return available[0];
  }

  /**
   * Get diagnostics about why no slot is available
   */
  getDiagnostics(instances: ParserInstance[]): {
    total: number;
    enabled: number;
    available: number;
    rateLimited: number;
    inCooldown: number;
  } {
    const now = Date.now();
    let enabled = 0;
    let available = 0;
    let rateLimited = 0;
    let inCooldown = 0;

    for (const inst of instances) {
      if (!inst.enabled) continue;
      enabled++;

      const isRateLimited = inst.usedInWindow >= inst.limitPerHour;
      const isInCooldown = inst.cooldownUntil && inst.cooldownUntil > now;

      if (isRateLimited) rateLimited++;
      if (isInCooldown) inCooldown++;
      if (!isRateLimited && !isInCooldown) available++;
    }

    return {
      total: instances.length,
      enabled,
      available,
      rateLimited,
      inCooldown,
    };
  }
}

// Singleton export
export const slotSelector = new SlotSelector();
