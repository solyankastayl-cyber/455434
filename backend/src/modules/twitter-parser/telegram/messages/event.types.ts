/**
 * Twitter Parser Module — Telegram Event Types
 * 
 * Event type definitions.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT ADD new events without contract update
 */

// USER events - sent to individual users
export type UserTelegramEvent =
  | 'NEW_TWEETS'
  | 'SESSION_EXPIRED'
  | 'SESSION_RESYNCED'
  | 'SESSION_OK'
  | 'SESSION_STALE'
  | 'TARGET_COOLDOWN'
  | 'HIGH_RISK'
  | 'PARSE_COMPLETED'
  | 'PARSE_ABORTED';

// SYSTEM events - sent to admin channel only
export type SystemTelegramEvent =
  | 'PARSER_DOWN'
  | 'PARSER_UP'
  | 'ABORT_RATE_HIGH'
  | 'SYSTEM_COOLDOWN';

// All events
export type TelegramEvent = UserTelegramEvent | SystemTelegramEvent;

// Event scope
export type EventScope = 'USER' | 'SYSTEM';

// Payload types
export type EventPayload = Record<string, any>;

// Message output
export interface TelegramMessage {
  text: string;
  title?: string;
  buttons?: Array<{ text: string; url: string }>;
}

// Send event params
export interface SendEventParams {
  event: TelegramEvent;
  userId?: string;        // Required for USER scope
  payload: EventPayload;
  scope: EventScope;
}

// Send result
export interface SendEventResult {
  sent: boolean;
  reason?: string;
  messageId?: number;
}

/**
 * Check if event is USER scope
 */
export function isUserEvent(event: TelegramEvent): event is UserTelegramEvent {
  const userEvents: UserTelegramEvent[] = [
    'NEW_TWEETS', 'SESSION_EXPIRED', 'SESSION_RESYNCED', 'SESSION_OK',
    'SESSION_STALE', 'TARGET_COOLDOWN', 'HIGH_RISK', 'PARSE_COMPLETED', 'PARSE_ABORTED'
  ];
  return userEvents.includes(event as UserTelegramEvent);
}

/**
 * Check if event is SYSTEM scope
 */
export function isSystemEvent(event: TelegramEvent): event is SystemTelegramEvent {
  const systemEvents: SystemTelegramEvent[] = [
    'PARSER_DOWN', 'PARSER_UP', 'ABORT_RATE_HIGH', 'SYSTEM_COOLDOWN'
  ];
  return systemEvents.includes(event as SystemTelegramEvent);
}
