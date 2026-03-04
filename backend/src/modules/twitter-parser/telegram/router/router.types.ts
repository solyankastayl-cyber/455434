/**
 * Twitter Parser Module — Router Types
 * 
 * Types for event routing.
 * Based on: v4.2-final
 */

import type { TelegramEvent, EventScope, SendEventResult } from '../messages/event.types.js';

// Event to preference key mapping — FROZEN
export const EVENT_TO_PREF: Record<TelegramEvent, string | null> = {
  'NEW_TWEETS': null,                 // Custom handling per target
  'SESSION_EXPIRED': 'sessionInvalid',
  'SESSION_RESYNCED': 'sessionOk',
  'SESSION_OK': 'sessionOk',
  'SESSION_STALE': 'sessionStale',
  'TARGET_COOLDOWN': 'cooldown',
  'HIGH_RISK': 'highRisk',
  'PARSE_COMPLETED': 'parseCompleted',
  'PARSE_ABORTED': 'parseAborted',
  'PARSER_DOWN': null,                // SYSTEM only
  'PARSER_UP': null,                  // SYSTEM only
  'ABORT_RATE_HIGH': null,            // SYSTEM only
  'SYSTEM_COOLDOWN': null,            // SYSTEM only
};

// User connection interface
export interface UserConnection {
  userId: string;
  chatId: string;
  isActive: boolean;
  eventPreferences?: {
    sessionInvalid?: boolean;
    sessionOk?: boolean;
    sessionStale?: boolean;
    cooldown?: boolean;
    highRisk?: boolean;
    parseCompleted?: boolean;
    parseAborted?: boolean;
  };
}

// Router send function type
export type SendFunction = (chatId: string, text: string, options?: { parseMode?: 'HTML' }) => Promise<{
  ok: boolean;
  messageId?: number;
  error?: string;
}>;

// System send function type
export type SystemSendFunction = (params: {
  type: string;
  title: string;
  message: string;
  meta?: any;
}) => Promise<void>;

// Connection finder function type
export type ConnectionFinder = (userId: string) => Promise<UserConnection | null>;
