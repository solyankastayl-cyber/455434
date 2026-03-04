/**
 * X1 — Provider Health & Circuit Breaker
 * =======================================
 * 
 * Circuit breaker logic:
 * - 3 consecutive errors → DEGRADED
 * - 5 consecutive errors → DOWN
 * - Any success → UP, reset streak
 */

import { ProviderHealth, ProviderId, ProviderStatus } from './exchangeProvider.types.js';

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════

const DEGRADED_THRESHOLD = 3;
const DOWN_THRESHOLD = 5;

// ═══════════════════════════════════════════════════════════════
// HEALTH MANAGEMENT
// ═══════════════════════════════════════════════════════════════

/**
 * Create initial health state for a provider
 */
export function createInitialHealth(id: ProviderId): ProviderHealth {
  return {
    id,
    status: 'UP',
    errorStreak: 0,
    lastOkAt: Date.now(),
  };
}

/**
 * Register successful request - reset error streak
 */
export function registerSuccess(health: ProviderHealth): ProviderHealth {
  return {
    ...health,
    status: 'UP',
    errorStreak: 0,
    lastOkAt: Date.now(),
  };
}

/**
 * Register failed request - increment error streak and update status
 */
export function registerError(health: ProviderHealth, error?: string): ProviderHealth {
  const errorStreak = health.errorStreak + 1;
  
  let status: ProviderStatus = health.status;
  
  if (errorStreak >= DOWN_THRESHOLD) {
    status = 'DOWN';
  } else if (errorStreak >= DEGRADED_THRESHOLD) {
    status = 'DEGRADED';
  }
  
  const notes = health.notes ? [...health.notes] : [];
  if (error && notes.length < 5) {
    notes.push(`[${new Date().toISOString()}] ${error}`);
  }
  
  return {
    ...health,
    status,
    errorStreak,
    lastErrorAt: Date.now(),
    notes,
  };
}

/**
 * Reset circuit breaker (admin action)
 */
export function resetHealth(health: ProviderHealth): ProviderHealth {
  return {
    ...health,
    status: 'UP',
    errorStreak: 0,
    notes: [],
  };
}

/**
 * Update rate limit info
 */
export function updateRateLimit(
  health: ProviderHealth,
  remaining?: number,
  resetAt?: number
): ProviderHealth {
  return {
    ...health,
    rateLimit: {
      remaining,
      resetAt,
    },
  };
}

/**
 * Check if provider is usable
 */
export function isUsable(health: ProviderHealth): boolean {
  return health.status !== 'DOWN';
}

console.log('[X1] Provider Health module loaded');
