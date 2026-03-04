/**
 * Twitter Parser Module — Preflight Check
 * 
 * Pure preflight validation logic.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY status values or check logic
 */

import type { SyncStatus, SyncMessage } from '../messages/sync-messages.js';
import { getSyncMessage, buildPreflightResponse } from '../messages/sync-messages.js';
import { validateCookies, normalizeCookies, type Cookie } from './cookie.validator.js';

export interface PreflightInput {
  cookies: Cookie[];
  hasApiKey: boolean;
  apiKeyValid?: boolean;
  systemHealthy?: boolean;
}

export interface PreflightResult {
  ok: boolean;
  state: SyncStatus;
  details: {
    hasAuth: boolean;
    cookiesCount: number;
    foundAuth: string[];
    missing?: string[];
    expired?: string[];
  };
  fixHint: string;
  message: SyncMessage;
  canSync: boolean;
}

/**
 * Run preflight check for extension/web
 * 
 * Check order (FROZEN):
 * 1. API key presence
 * 2. Cookies presence and validity
 * 3. System health (optional)
 */
export function runPreflightCheck(input: PreflightInput): PreflightResult {
  const { cookies, hasApiKey, apiKeyValid, systemHealthy } = input;
  
  // 1. Check API key
  if (!hasApiKey) {
    return buildResult('API_KEY_INVALID', {
      hasAuth: false,
      cookiesCount: 0,
      foundAuth: [],
    });
  }
  
  if (apiKeyValid === false) {
    return buildResult('API_KEY_INVALID', {
      hasAuth: false,
      cookiesCount: 0,
      foundAuth: [],
    });
  }
  
  // 2. Check cookies
  const normalized = normalizeCookies(cookies);
  const validation = validateCookies(normalized);
  
  if (!validation.valid) {
    return buildResult(validation.status, {
      hasAuth: hasApiKey,
      cookiesCount: validation.details.cookiesCount,
      foundAuth: validation.foundAuth,
      missing: validation.missing,
      expired: validation.expired,
    });
  }
  
  // 3. Check system health (if provided)
  if (systemHealthy === false) {
    return buildResult('SERVICE_UNAVAILABLE', {
      hasAuth: hasApiKey,
      cookiesCount: validation.details.cookiesCount,
      foundAuth: validation.foundAuth,
    });
  }
  
  // All checks passed
  return buildResult('READY', {
    hasAuth: hasApiKey,
    cookiesCount: validation.details.cookiesCount,
    foundAuth: validation.foundAuth,
  });
}

/**
 * Build preflight result
 */
function buildResult(
  status: SyncStatus,
  details: PreflightResult['details']
): PreflightResult {
  const message = getSyncMessage(status);
  
  return {
    ok: status === 'READY',
    state: status,
    details,
    fixHint: message.fixHint,
    message,
    canSync: status === 'READY' || status === 'PARTIAL',
  };
}

/**
 * Extract API key status from Authorization header
 */
export function extractApiKeyFromHeader(authHeader?: string): {
  hasKey: boolean;
  key?: string;
} {
  if (!authHeader) {
    return { hasKey: false };
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    return { hasKey: false };
  }
  
  const key = authHeader.slice(7).trim();
  if (!key) {
    return { hasKey: false };
  }
  
  return { hasKey: true, key };
}

/**
 * Map error code to sync status
 */
export function errorCodeToSyncStatus(errorCode: string): SyncStatus {
  switch (errorCode) {
    case 'COOKIES_EMPTY':
    case 'NO_COOKIES':
      return 'NO_COOKIES';
    case 'SESSION_EXPIRED':
    case 'AUTH_TOKEN_EXPIRED':
    case 'AUTH_TOKEN_MISSING':
    case 'COOKIES_MISSING':
      return 'SESSION_EXPIRED';
    case 'API_KEY_INVALID':
    case 'UNAUTHORIZED':
      return 'API_KEY_INVALID';
    case 'PARSER_DOWN':
    case 'SERVICE_UNAVAILABLE':
      return 'SERVICE_UNAVAILABLE';
    case 'NETWORK_ERROR':
    case 'ECONNREFUSED':
      return 'NETWORK_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}
