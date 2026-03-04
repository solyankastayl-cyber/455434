/**
 * Twitter Parser Module — Chrome Adapter
 * 
 * Converts Chrome Extension payload to module format.
 * Based on: v4.2-final
 */

import type { Cookie } from '../preflight/cookie.validator.js';
import type { SyncInput } from '../sync/sync.types.js';

export interface ChromeExtensionPayload {
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expirationDate?: number;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
  accountId?: string;
  userAgent?: string;
}

/**
 * Convert Chrome Extension payload to SyncInput
 */
export function fromChromePayload(payload: ChromeExtensionPayload): SyncInput {
  const cookies: Cookie[] = (payload.cookies || []).map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expirationDate,
    httpOnly: c.httpOnly,
    secure: c.secure,
  }));
  
  return {
    cookies,
    accountId: payload.accountId,
    source: 'chrome',
    userAgent: payload.userAgent || 'Chrome-Extension',
  };
}

/**
 * Validate Chrome Extension request structure
 */
export function validateChromeRequest(body: any): {
  valid: boolean;
  error?: string;
  payload?: ChromeExtensionPayload;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (!body.cookies || !Array.isArray(body.cookies)) {
    return { valid: false, error: 'Missing cookies array' };
  }
  
  return {
    valid: true,
    payload: body as ChromeExtensionPayload,
  };
}
