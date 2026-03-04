/**
 * Twitter Parser Module — Cookie Validator
 * 
 * Pure cookie validation logic.
 * Based on: v4.2-final
 * 
 * FROZEN: DO NOT MODIFY validation rules
 */

import type { SyncStatus } from '../messages/sync-messages.js';

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
}

export interface CookieValidationResult {
  valid: boolean;
  status: SyncStatus;
  foundAuth: string[];
  missing: string[];
  expired: string[];
  details: {
    hasAuthToken: boolean;
    hasCt0: boolean;
    hasTwid: boolean;
    cookiesCount: number;
  };
}

// Required cookies for Twitter auth
const REQUIRED_COOKIES = ['auth_token', 'ct0'];
const OPTIONAL_COOKIES = ['twid'];
const MIN_REQUIRED = 2;

/**
 * Validate cookies for sync readiness
 */
export function validateCookies(cookies: Cookie[]): CookieValidationResult {
  if (!cookies || cookies.length === 0) {
    return {
      valid: false,
      status: 'NO_COOKIES',
      foundAuth: [],
      missing: [...REQUIRED_COOKIES, ...OPTIONAL_COOKIES],
      expired: [],
      details: {
        hasAuthToken: false,
        hasCt0: false,
        hasTwid: false,
        cookiesCount: 0,
      },
    };
  }
  
  const authCookies = [...REQUIRED_COOKIES, ...OPTIONAL_COOKIES];
  const foundAuth: string[] = [];
  const missing: string[] = [];
  const expired: string[] = [];
  
  const now = Date.now();
  
  for (const name of authCookies) {
    const cookie = cookies.find(c => c.name === name && c.value);
    
    if (!cookie) {
      missing.push(name);
      continue;
    }
    
    // Check expiration
    if (cookie.expires && cookie.expires * 1000 < now) {
      expired.push(name);
      continue;
    }
    
    foundAuth.push(name);
  }
  
  const hasAuthToken = foundAuth.includes('auth_token');
  const hasCt0 = foundAuth.includes('ct0');
  const hasTwid = foundAuth.includes('twid');
  
  const details = {
    hasAuthToken,
    hasCt0,
    hasTwid,
    cookiesCount: cookies.length,
  };
  
  // Determine status
  if (foundAuth.length < MIN_REQUIRED) {
    // Check if it's expiration or missing
    if (expired.length > 0 && expired.includes('auth_token')) {
      return {
        valid: false,
        status: 'SESSION_EXPIRED',
        foundAuth,
        missing,
        expired,
        details,
      };
    }
    
    return {
      valid: false,
      status: 'SESSION_EXPIRED',
      foundAuth,
      missing,
      expired,
      details,
    };
  }
  
  // Check if critical cookie (auth_token) is present
  if (!hasAuthToken) {
    return {
      valid: false,
      status: 'SESSION_EXPIRED',
      foundAuth,
      missing,
      expired,
      details,
    };
  }
  
  return {
    valid: true,
    status: 'READY',
    foundAuth,
    missing,
    expired,
    details,
  };
}

/**
 * Normalize cookies from different formats
 */
export function normalizeCookies(input: any[]): Cookie[] {
  if (!Array.isArray(input)) return [];
  
  return input.map(c => ({
    name: c.name || '',
    value: c.value || '',
    domain: c.domain,
    path: c.path,
    expires: c.expires || c.expirationDate,
    httpOnly: c.httpOnly,
    secure: c.secure,
  })).filter(c => c.name && c.value);
}

/**
 * Filter cookies for Twitter domain only
 */
export function filterTwitterCookies(cookies: Cookie[]): Cookie[] {
  return cookies.filter(c => {
    const domain = (c.domain || '').toLowerCase();
    return domain.includes('twitter.com') || domain.includes('x.com');
  });
}

/**
 * Check if any cookie is about to expire (within 24h)
 */
export function checkExpirationWarning(cookies: Cookie[]): {
  hasWarning: boolean;
  expiringCookies: string[];
  nearestExpiration?: Date;
} {
  const now = Date.now();
  const warningThreshold = 24 * 60 * 60 * 1000; // 24 hours
  
  const expiringCookies: string[] = [];
  let nearestExpiration: Date | undefined;
  
  for (const cookie of cookies) {
    if (!cookie.expires) continue;
    
    const expiresAt = cookie.expires * 1000;
    const timeLeft = expiresAt - now;
    
    if (timeLeft > 0 && timeLeft < warningThreshold) {
      expiringCookies.push(cookie.name);
      
      if (!nearestExpiration || expiresAt < nearestExpiration.getTime()) {
        nearestExpiration = new Date(expiresAt);
      }
    }
  }
  
  return {
    hasWarning: expiringCookies.length > 0,
    expiringCookies,
    nearestExpiration,
  };
}
