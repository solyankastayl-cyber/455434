/**
 * Twitter Parser Module — Sync Routes
 * 
 * Handles cookie sync from Chrome Extension / Web.
 * Based on: v4.2-final
 * 
 * Uses: extension/ module
 */

import type { PreflightRequest, PreflightResponse, SyncRequest, SyncResponse } from '../types.js';
import { extractApiKey, unauthorizedResponse } from '../middleware/api-key.guard.js';
import { runPreflightCheck, extractApiKeyFromHeader } from '../../extension/preflight/preflight.check.js';
import { fromChromePayload } from '../../extension/adapters/chrome.adapter.js';
import { fromWebPayload } from '../../extension/adapters/web.adapter.js';
import { normalizeCookies } from '../../extension/preflight/cookie.validator.js';

/**
 * Route handler types (framework-agnostic)
 */
export interface SyncRouteHandlers {
  /**
   * POST /twitter/sync/preflight
   * 
   * Check if cookies are valid before sync
   */
  preflight: (req: {
    headers: Record<string, string | undefined>;
    body: PreflightRequest;
  }) => Promise<PreflightResponse>;
  
  /**
   * POST /twitter/sync/start
   * 
   * Start sync with provided cookies
   * Note: Actual sync requires host's session service
   */
  start: (req: {
    headers: Record<string, string | undefined>;
    body: SyncRequest;
  }) => Promise<SyncResponse>;
  
  /**
   * GET /twitter/sync/status
   * 
   * Get current sync status
   * Note: Requires host's session service
   */
  status: (req: {
    headers: Record<string, string | undefined>;
    query: { sessionId?: string };
  }) => Promise<{ ok: boolean; synced: boolean; lastSyncAt?: string }>;
}

/**
 * Create sync route handlers
 */
export function createSyncHandlers(): SyncRouteHandlers {
  return {
    preflight: async (req) => {
      // Check API key
      const { hasKey } = extractApiKeyFromHeader(req.headers['authorization']);
      
      if (!hasKey) {
        return {
          ok: false,
          state: 'API_KEY_INVALID',
          details: { hasAuth: false, cookiesCount: 0, foundAuth: [] },
          fixHint: 'Please enter a valid API key',
          canSync: false,
        };
      }
      
      // Normalize cookies
      const cookies = normalizeCookies(req.body.cookies || []);
      
      // Run preflight check
      const result = runPreflightCheck({
        cookies,
        hasApiKey: true,
        apiKeyValid: true, // Host validates actual key
        systemHealthy: true, // Assume healthy, host can override
      });
      
      return {
        ok: result.ok,
        state: result.state,
        details: result.details,
        fixHint: result.fixHint,
        canSync: result.canSync,
      };
    },
    
    start: async (req) => {
      // Check API key
      const { hasKey } = extractApiKeyFromHeader(req.headers['authorization']);
      
      if (!hasKey) {
        return {
          ok: false,
          status: 'FAILED',
          message: 'Invalid API key',
        };
      }
      
      // Prepare sync input based on source
      const source = req.body.source || 'web';
      const input = source === 'chrome' 
        ? fromChromePayload({ cookies: req.body.cookies, accountId: req.body.accountId })
        : fromWebPayload({ cookies: req.body.cookies, accountId: req.body.accountId, source });
      
      // Note: Actual sync requires host's session service
      // This is just the module interface
      return {
        ok: true,
        status: 'SUCCESS',
        message: 'Sync initiated (host must implement actual sync)',
      };
    },
    
    status: async (req) => {
      // Note: Requires host's session service
      return {
        ok: true,
        synced: false,
        lastSyncAt: undefined,
      };
    },
  };
}

export const syncHandlers = createSyncHandlers();
