/**
 * Twitter Parser Module — Backoff Strategy
 * 
 * Exponential backoff with max delay cap.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY thresholds
 */

const BASE_DELAY_MS = 30_000;       // 30 seconds
const MAX_DELAY_MS = 15 * 60_000;   // 15 minutes
const MAX_ATTEMPTS = 3;

export interface BackoffResult {
  delayMs: number;
  canRetry: boolean;
}

export function computeBackoff(retryCount: number): BackoffResult {
  if (retryCount >= MAX_ATTEMPTS) {
    return { delayMs: 0, canRetry: false };
  }

  const delay = Math.min(
    BASE_DELAY_MS * Math.pow(2, retryCount),
    MAX_DELAY_MS
  );

  return { delayMs: delay, canRetry: true };
}

export function getMaxAttempts(): number {
  return MAX_ATTEMPTS;
}
