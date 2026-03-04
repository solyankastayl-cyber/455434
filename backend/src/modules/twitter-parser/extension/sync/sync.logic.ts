/**
 * Twitter Parser Module — Sync Logic
 * 
 * Pure sync logic without database dependencies.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY sync contract
 */

import type { SyncInput, SyncResult, SyncContext } from './sync.types.js';
import type { SyncStatus } from '../messages/sync-messages.js';
import { validateCookies, normalizeCookies } from '../preflight/cookie.validator.js';
import { getSyncMessage } from '../messages/sync-messages.js';

/**
 * Sync service interface
 * 
 * Implemented by host application with actual database operations
 */
export interface ISyncService {
  sync(input: SyncInput, context: SyncContext): Promise<SyncResult>;
}

/**
 * Prepare sync input for processing
 */
export function prepareSyncInput(input: SyncInput): {
  valid: boolean;
  status: SyncStatus;
  normalizedCookies: any[];
  message: string;
} {
  const normalized = normalizeCookies(input.cookies);
  const validation = validateCookies(normalized);
  
  if (!validation.valid) {
    const msg = getSyncMessage(validation.status);
    return {
      valid: false,
      status: validation.status,
      normalizedCookies: normalized,
      message: msg.fixHint,
    };
  }
  
  return {
    valid: true,
    status: 'READY',
    normalizedCookies: normalized,
    message: 'Cookies validated successfully',
  };
}

/**
 * Build sync result from outcome
 */
export function buildSyncResult(
  success: boolean,
  status: SyncStatus,
  details: {
    sessionId?: string;
    accountId?: string;
    cookiesCount: number;
    savedCookies: number;
    errors?: string[];
  }
): SyncResult {
  const message = getSyncMessage(status);
  
  let resultStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  if (success && details.savedCookies === details.cookiesCount) {
    resultStatus = 'SUCCESS';
  } else if (success && details.savedCookies > 0) {
    resultStatus = 'PARTIAL';
  } else {
    resultStatus = 'FAILED';
  }
  
  return {
    ok: success,
    status: resultStatus,
    syncStatus: status,
    sessionId: details.sessionId,
    accountId: details.accountId,
    message: message.text,
    details: {
      cookiesCount: details.cookiesCount,
      savedCookies: details.savedCookies,
      errors: details.errors,
    },
  };
}

/**
 * Determine sync source from user agent or explicit source
 */
export function detectSyncSource(
  explicitSource?: string,
  userAgent?: string
): 'chrome' | 'web' | 'zip' {
  if (explicitSource) {
    if (explicitSource === 'chrome' || explicitSource === 'web' || explicitSource === 'zip') {
      return explicitSource;
    }
  }
  
  if (userAgent) {
    if (userAgent.includes('Chrome-Extension')) {
      return 'chrome';
    }
    if (userAgent.includes('ZIP-Standalone')) {
      return 'zip';
    }
  }
  
  return 'web';
}

/**
 * Log sync attempt for audit
 */
export function formatSyncLog(input: SyncInput, result: SyncResult): string {
  return [
    `[Sync] source=${input.source}`,
    `status=${result.status}`,
    `syncStatus=${result.syncStatus}`,
    `cookies=${input.cookies.length}`,
    `saved=${result.details?.savedCookies || 0}`,
    result.sessionId ? `sessionId=${result.sessionId}` : '',
    result.details?.errors?.length ? `errors=${result.details.errors.join(',')}` : '',
  ].filter(Boolean).join(' ');
}
