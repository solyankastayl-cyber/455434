/**
 * Twitter Parser Module — Web Adapter
 * 
 * Converts Web UI payload to module format.
 * Based on: v4.2-final
 */

import type { Cookie } from '../preflight/cookie.validator.js';
import type { SyncInput } from '../sync/sync.types.js';

export interface WebUIPayload {
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
  }>;
  accountId?: string;
  source?: 'web' | 'zip';
}

/**
 * Convert Web UI payload to SyncInput
 */
export function fromWebPayload(payload: WebUIPayload, ip?: string): SyncInput {
  const cookies: Cookie[] = (payload.cookies || []).map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires,
    httpOnly: c.httpOnly,
    secure: c.secure,
  }));
  
  return {
    cookies,
    accountId: payload.accountId,
    source: payload.source || 'web',
    ip,
  };
}

/**
 * Convert ZIP file cookies (from cookies.json) to SyncInput
 */
export function fromZipCookies(
  rawCookies: any[],
  accountId?: string
): SyncInput {
  const cookies: Cookie[] = (rawCookies || []).map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expires || c.expirationDate,
    httpOnly: c.httpOnly,
    secure: c.secure,
  }));
  
  return {
    cookies,
    accountId,
    source: 'zip',
    userAgent: 'ZIP-Standalone',
  };
}

/**
 * Validate Web UI request structure
 */
export function validateWebRequest(body: any): {
  valid: boolean;
  error?: string;
  payload?: WebUIPayload;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body' };
  }
  
  if (!body.cookies || !Array.isArray(body.cookies)) {
    return { valid: false, error: 'Missing cookies array' };
  }
  
  return {
    valid: true,
    payload: body as WebUIPayload,
  };
}
