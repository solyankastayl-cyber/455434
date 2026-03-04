/**
 * Twitter Parser Module — Sync Messages
 * 
 * Single source of truth for all sync-related messages.
 * Used by: Chrome Extension, Web UI, ZIP/Standalone
 * 
 * Based on: v4.2-final
 * CONTRACT: EXTENSION_SYNC_CONTRACT.md v1.0
 * 
 * FROZEN: DO NOT MODIFY without contract update
 */

export type SyncStatus = 
  | 'READY'
  | 'NO_COOKIES'
  | 'SESSION_EXPIRED'
  | 'API_KEY_INVALID'
  | 'PARTIAL'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'INTERNAL_ERROR';

export type UserAction = 
  | 'OPEN_TWITTER'
  | 'SYNC'
  | 'REPLACE_KEY'
  | 'RETRY'
  | 'WAIT';

export interface SyncMessage {
  status: SyncStatus;
  title: string;
  text: string;
  fixHint: string;
  actions: UserAction[];
  severity: 'info' | 'warning' | 'error';
  icon: string;
}

/**
 * Canonical sync messages — DO NOT MODIFY without contract update
 */
export const SYNC_MESSAGES: Record<SyncStatus, SyncMessage> = {
  READY: {
    status: 'READY',
    title: 'Ready to sync',
    text: 'Your Twitter session is detected and valid.',
    fixHint: 'Click Sync to connect your account.',
    actions: ['SYNC'],
    severity: 'info',
    icon: '✅',
  },
  
  NO_COOKIES: {
    status: 'NO_COOKIES',
    title: 'Not logged into Twitter',
    text: 'You are not logged into Twitter.',
    fixHint: 'Open twitter.com and log in, then try again.',
    actions: ['OPEN_TWITTER'],
    severity: 'error',
    icon: '❌',
  },
  
  SESSION_EXPIRED: {
    status: 'SESSION_EXPIRED',
    title: 'Session expired',
    text: 'Your Twitter session has expired.',
    fixHint: 'Log in to Twitter and sync again.',
    actions: ['OPEN_TWITTER', 'SYNC'],
    severity: 'error',
    icon: '❌',
  },
  
  API_KEY_INVALID: {
    status: 'API_KEY_INVALID',
    title: 'Invalid API key',
    text: 'This API key is invalid or revoked.',
    fixHint: 'Update your API key and try again.',
    actions: ['REPLACE_KEY'],
    severity: 'error',
    icon: '🔴',
  },
  
  PARTIAL: {
    status: 'PARTIAL',
    title: 'Partial sync',
    text: 'Some session data could not be synced.',
    fixHint: 'You may need to sync again later.',
    actions: ['SYNC'],
    severity: 'warning',
    icon: '⚠️',
  },
  
  SERVICE_UNAVAILABLE: {
    status: 'SERVICE_UNAVAILABLE',
    title: 'Service unavailable',
    text: 'The service is temporarily unavailable.',
    fixHint: 'Please try again in a moment.',
    actions: ['WAIT', 'RETRY'],
    severity: 'warning',
    icon: '⏳',
  },
  
  NETWORK_ERROR: {
    status: 'NETWORK_ERROR',
    title: 'Connection error',
    text: "We couldn't reach the FOMO API.",
    fixHint: 'Check your internet connection and try again.',
    actions: ['RETRY'],
    severity: 'error',
    icon: '🔌',
  },
  
  INTERNAL_ERROR: {
    status: 'INTERNAL_ERROR',
    title: 'Something went wrong',
    text: 'An unexpected error occurred.',
    fixHint: 'Please try again.',
    actions: ['RETRY'],
    severity: 'error',
    icon: '❓',
  },
};

/**
 * Get message for status
 */
export function getSyncMessage(status: SyncStatus): SyncMessage {
  return SYNC_MESSAGES[status] || SYNC_MESSAGES.INTERNAL_ERROR;
}

/**
 * Get action button text
 */
export function getActionText(action: UserAction): string {
  switch (action) {
    case 'OPEN_TWITTER':
      return 'Open Twitter';
    case 'SYNC':
      return 'Sync Session';
    case 'REPLACE_KEY':
      return 'Update API Key';
    case 'RETRY':
      return 'Try Again';
    case 'WAIT':
      return 'Wait';
    default:
      return action;
  }
}

/**
 * Build preflight response with canonical message
 */
export function buildPreflightResponse(
  status: SyncStatus,
  details: Record<string, any> = {}
): {
  ok: boolean;
  state: SyncStatus;
  details: Record<string, any>;
  fixHint: string;
  message: SyncMessage;
} {
  const message = getSyncMessage(status);
  
  return {
    ok: status === 'READY',
    state: status,
    details,
    fixHint: message.fixHint,
    message,
  };
}
