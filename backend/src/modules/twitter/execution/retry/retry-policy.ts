/**
 * Phase 4.1 — Retry Policy
 * Determines whether a task should be retried based on error code
 */

export enum RetryDecision {
  RETRY = 'RETRY',
  NO_RETRY = 'NO_RETRY',
  COOLDOWN = 'COOLDOWN',
}

const RETRYABLE_ERRORS = new Set([
  'PARSER_DOWN',
  'ECONNRESET',
  'ETIMEDOUT',
  'NETWORK_ERROR',
  'ECONNREFUSED',
]);

const NO_RETRY_ERRORS = new Set([
  'SESSION_INVALID',
  'SESSION_EXPIRED',
  'DECRYPT_FAILED',
  'AUTH_REQUIRED',
  'ALL_SESSIONS_INVALID',
  'NO_SESSIONS',
  'NO_ACCOUNTS',
  'CONSENT_REQUIRED',
  'SESSION_DECRYPT_FAILED',
]);

const COOLDOWN_ERRORS = new Set([
  'RATE_LIMIT',
  'RATE_LIMITED',
  'SLOT_RATE_LIMITED',
]);

export function shouldRetry(errorCode?: string): RetryDecision {
  if (!errorCode) return RetryDecision.NO_RETRY;

  if (RETRYABLE_ERRORS.has(errorCode)) return RetryDecision.RETRY;
  if (COOLDOWN_ERRORS.has(errorCode)) return RetryDecision.COOLDOWN;
  if (NO_RETRY_ERRORS.has(errorCode)) return RetryDecision.NO_RETRY;

  // Check if error contains any retryable pattern
  for (const err of RETRYABLE_ERRORS) {
    if (errorCode.includes(err)) return RetryDecision.RETRY;
  }

  // default-safe: no retry for unknown errors
  return RetryDecision.NO_RETRY;
}
