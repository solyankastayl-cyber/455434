/**
 * Scroll Profiles - параметры безопасного парсинга
 * 
 * SAFE → NORMAL → AGGRESSIVE
 * Downgrade автоматически при риске
 * Upgrade только вручную или новое окно
 */

export enum ScrollProfile {
  SAFE = 'SAFE',
  NORMAL = 'NORMAL',
  AGGRESSIVE = 'AGGRESSIVE',
}

export interface ScrollPolicy {
  /** Min delay between scrolls (ms) */
  minDelayMs: number;
  
  /** Max delay between scrolls (ms) */
  maxDelayMs: number;
  
  /** Min scroll distance (px) */
  scrollPxMin: number;
  
  /** Max scroll distance (px) */
  scrollPxMax: number;
  
  /** Posts per batch/fetch */
  batchSize: number;
  
  /** Max scrolls per minute */
  maxScrollsPerMinute: number;
  
  /** Expected posts per hour */
  expectedPostsPerHour: number;
}

export const SCROLL_POLICIES: Record<ScrollProfile, ScrollPolicy> = {
  [ScrollProfile.SAFE]: {
    minDelayMs: 3000,
    maxDelayMs: 6000,
    scrollPxMin: 400,
    scrollPxMax: 800,
    batchSize: 10,
    maxScrollsPerMinute: 12,
    expectedPostsPerHour: 150,
  },
  [ScrollProfile.NORMAL]: {
    minDelayMs: 2000,
    maxDelayMs: 4000,
    scrollPxMin: 500,
    scrollPxMax: 1000,
    batchSize: 15,
    maxScrollsPerMinute: 18,
    expectedPostsPerHour: 250,
  },
  [ScrollProfile.AGGRESSIVE]: {
    minDelayMs: 1000,
    maxDelayMs: 2500,
    scrollPxMin: 600,
    scrollPxMax: 1200,
    batchSize: 20,
    maxScrollsPerMinute: 25,
    expectedPostsPerHour: 400,
  },
};

/**
 * Get next profile in downgrade chain
 */
export function downgradeProfile(current: ScrollProfile): ScrollProfile | null {
  switch (current) {
    case ScrollProfile.AGGRESSIVE:
      return ScrollProfile.NORMAL;
    case ScrollProfile.NORMAL:
      return ScrollProfile.SAFE;
    case ScrollProfile.SAFE:
      return null; // Can't downgrade further
  }
}

/**
 * Get random value in range
 */
export function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
