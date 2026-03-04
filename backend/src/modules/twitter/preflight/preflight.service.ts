// Twitter Preflight Check Service
// PHASE 2.2: Integrated with Twitter Error Code Registry
// Validates all prerequisites before running parser

import axios from 'axios';
import { sessionService } from '../sessions/session.service.js';
import { env } from '../../../config/env.js';

// Runtime imports
import { TwitterErrorCode } from '../errors/twitter-error-codes.js';

// Type-only imports
import type { ErrorSeverity } from '../errors/twitter-error-codes.js';

interface PreflightBlocker {
  code: TwitterErrorCode;
  severity: ErrorSeverity;
  message: string;
}

interface PreflightCheck {
  status: 'ok' | 'blocked';
  canRun: boolean;
  checks: {
    services: {
      backend: string;
      parser: string;
      browser: string;
    };
    session: {
      exists: boolean;
      cookiesPresent: boolean;
      cookiesCount: number;
      errorCode?: TwitterErrorCode;
    };
    account: {
      enabled: boolean;
      cooldown: boolean;
    };
    proxy: {
      mode: string;
      status: string;
    };
  };
  blockers: PreflightBlocker[];
}

/**
 * Check if Twitter Parser V2 is alive
 */
async function isParserAlive(): Promise<boolean> {
  const parserUrl = env.PARSER_URL || 'http://localhost:5001';
  try {
    const res = await axios.get(`${parserUrl}/health`, { timeout: 3000 });
    return res.data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Check if browser is ready in parser
 */
async function isBrowserReady(): Promise<boolean> {
  const parserUrl = env.PARSER_URL || 'http://localhost:5001';
  try {
    const res = await axios.get(`${parserUrl}/health`, { timeout: 3000 });
    // Parser returns status: 'running' when browser is ready
    return res.data?.status === 'running';
  } catch {
    return false;
  }
}

/**
 * Run full preflight check before parsing
 */
export async function runTwitterPreflight(sessionId: string): Promise<PreflightCheck> {
  const checks: PreflightCheck['checks'] = {
    services: { backend: 'ok', parser: 'unknown', browser: 'unknown' },
    session: { exists: false, cookiesPresent: false, cookiesCount: 0 },
    account: { enabled: true, cooldown: false },
    proxy: { mode: 'direct', status: 'ok' }
  };
  const blockers: PreflightBlocker[] = [];

  // === SERVICES CHECK ===
  const parserAlive = await isParserAlive();
  const browserReady = await isBrowserReady();
  
  checks.services.parser = parserAlive ? 'ok' : 'down';
  checks.services.browser = browserReady ? 'ready' : 'not_ready';

  if (!parserAlive) {
    blockers.push({
      code: TwitterErrorCode.PARSER_DOWN,
      severity: 'INFO',
      message: 'Twitter Parser V2 is not running'
    });
  }

  if (!browserReady && parserAlive) {
    blockers.push({
      code: TwitterErrorCode.BROWSER_NOT_READY,
      severity: 'INFO',
      message: 'Browser is initializing'
    });
  }

  // === SESSION CHECK ===
  if (!sessionId) {
    checks.session.exists = false;
    checks.session.errorCode = TwitterErrorCode.SESSION_NOT_FOUND;
    blockers.push({
      code: TwitterErrorCode.SESSION_NOT_FOUND,
      severity: 'BLOCKED',
      message: 'No session ID provided'
    });
  } else {
    try {
      checks.session.exists = true;
      console.log('[PREFLIGHT] Calling sessionService.getCookies for:', sessionId);
      const cookies = await sessionService.getCookies(sessionId);
      console.log('[PREFLIGHT] getCookies returned:', cookies?.length, 'cookies');
      
      checks.session.cookiesCount = cookies?.length || 0;
      checks.session.cookiesPresent = cookies && cookies.length > 0;

      if (!cookies || cookies.length === 0) {
        checks.session.errorCode = TwitterErrorCode.COOKIES_EMPTY;
        blockers.push({
          code: TwitterErrorCode.COOKIES_EMPTY,
          severity: 'BLOCKED',
          message: 'No cookies available'
        });
      } else {
        // Check for required cookies
        const hasAuthToken = cookies.some(c => c.name === 'auth_token' && c.value);
        const hasCt0 = cookies.some(c => c.name === 'ct0' && c.value);
        
        if (!hasAuthToken) {
          checks.session.errorCode = TwitterErrorCode.AUTH_TOKEN_MISSING;
          blockers.push({
            code: TwitterErrorCode.AUTH_TOKEN_MISSING,
            severity: 'BLOCKED',
            message: 'auth_token cookie missing'
          });
        }
        
        if (!hasCt0) {
          blockers.push({
            code: TwitterErrorCode.COOKIES_MISSING,
            severity: 'BLOCKED',
            message: 'ct0 cookie missing'
          });
        }
        
        // Check expiration
        const authToken = cookies.find(c => c.name === 'auth_token');
        if (authToken?.expires && authToken.expires * 1000 < Date.now()) {
          checks.session.errorCode = TwitterErrorCode.AUTH_TOKEN_EXPIRED;
          blockers.push({
            code: TwitterErrorCode.AUTH_TOKEN_EXPIRED,
            severity: 'BLOCKED',
            message: 'auth_token has expired'
          });
        }
      }
    } catch (e: any) {
      checks.session.exists = false;
      checks.session.errorCode = TwitterErrorCode.SESSION_INVALID;
      blockers.push({
        code: TwitterErrorCode.SESSION_INVALID,
        severity: 'BLOCKED',
        message: e.message
      });
    }
  }

  // === PROXY CHECK (simplified - direct mode for now) ===
  checks.proxy = { mode: 'direct', status: 'ok' };

  return {
    status: blockers.length === 0 ? 'ok' : 'blocked',
    canRun: blockers.length === 0,
    checks,
    blockers
  };
}
