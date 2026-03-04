/**
 * Twitter Parser Module — System Event Adapter
 * 
 * Maps system events to Telegram events for admins.
 * Based on: v4.2-final
 */

import type { SendEventParams, SystemTelegramEvent } from '../messages/event.types.js';

/**
 * Create PARSER_DOWN event params
 */
export function parserDownEvent(params: {
  error: string;
}): SendEventParams {
  return {
    event: 'PARSER_DOWN',
    scope: 'SYSTEM',
    payload: params,
  };
}

/**
 * Create PARSER_UP event params
 */
export function parserUpEvent(params: {
  downtimeMinutes?: number;
}): SendEventParams {
  return {
    event: 'PARSER_UP',
    scope: 'SYSTEM',
    payload: params,
  };
}

/**
 * Create ABORT_RATE_HIGH event params
 */
export function abortRateHighEvent(params: {
  abortRate: number;
  threshold?: number;
}): SendEventParams {
  return {
    event: 'ABORT_RATE_HIGH',
    scope: 'SYSTEM',
    payload: params,
  };
}

/**
 * Create SYSTEM_COOLDOWN event params
 */
export function systemCooldownEvent(params: {
  reason?: string;
  durationMinutes?: number;
}): SendEventParams {
  return {
    event: 'SYSTEM_COOLDOWN',
    scope: 'SYSTEM',
    payload: params,
  };
}
