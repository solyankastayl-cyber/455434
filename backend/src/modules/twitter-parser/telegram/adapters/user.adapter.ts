/**
 * Twitter Parser Module — User Event Adapter
 * 
 * Maps runtime events to Telegram events for users.
 * Based on: v4.2-final
 */

import type { TelegramEvent, EventPayload, SendEventParams, UserTelegramEvent } from '../messages/event.types.js';

/**
 * Create NEW_TWEETS event params
 */
export function newTweetsEvent(userId: string, params: {
  count: number;
  target: string;
  targetType: 'keyword' | 'account';
  tweets?: Array<{ author?: string; text?: string }>;
}): SendEventParams {
  return {
    event: 'NEW_TWEETS',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create SESSION_EXPIRED event params
 */
export function sessionExpiredEvent(userId: string, params: {
  account?: string;
  reason?: string;
}): SendEventParams {
  return {
    event: 'SESSION_EXPIRED',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create SESSION_RESYNCED event params
 */
export function sessionResyncedEvent(userId: string, params: {
  account?: string;
}): SendEventParams {
  return {
    event: 'SESSION_RESYNCED',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create SESSION_OK event params
 */
export function sessionOkEvent(userId: string, params: {
  account?: string;
}): SendEventParams {
  return {
    event: 'SESSION_OK',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create SESSION_STALE event params
 */
export function sessionStaleEvent(userId: string, params: {
  account?: string;
}): SendEventParams {
  return {
    event: 'SESSION_STALE',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create TARGET_COOLDOWN event params
 */
export function targetCooldownEvent(userId: string, params: {
  target: string;
  reason?: string;
  durationMinutes: number;
}): SendEventParams {
  return {
    event: 'TARGET_COOLDOWN',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create HIGH_RISK event params
 */
export function highRiskEvent(userId: string, params: {
  riskScore: number;
}): SendEventParams {
  return {
    event: 'HIGH_RISK',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create PARSE_COMPLETED event params
 */
export function parseCompletedEvent(userId: string, params: {
  target?: string;
  fetched?: number;
}): SendEventParams {
  return {
    event: 'PARSE_COMPLETED',
    userId,
    scope: 'USER',
    payload: params,
  };
}

/**
 * Create PARSE_ABORTED event params
 */
export function parseAbortedEvent(userId: string, params: {
  target?: string;
  account?: string;
  reason: string;
}): SendEventParams {
  return {
    event: 'PARSE_ABORTED',
    userId,
    scope: 'USER',
    payload: params,
  };
}
