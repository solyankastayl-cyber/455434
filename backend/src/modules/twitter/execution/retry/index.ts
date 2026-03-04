/**
 * Phase 4.1 — Retry Module
 */
export { shouldRetry, RetryDecision } from './retry-policy.js';
export { computeBackoff, getMaxAttempts, type BackoffResult } from './backoff.js';
