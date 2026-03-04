/**
 * Twitter Parser Module — Sync Types
 * 
 * Types for sync operations.
 * Based on: v4.2-final
 */

import type { SyncStatus } from '../messages/sync-messages.js';
import type { Cookie } from '../preflight/cookie.validator.js';

export interface SyncInput {
  cookies: Cookie[];
  accountId?: string;
  source: 'chrome' | 'web' | 'zip';
  userAgent?: string;
  ip?: string;
}

export interface SyncResult {
  ok: boolean;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  syncStatus: SyncStatus;
  sessionId?: string;
  accountId?: string;
  message: string;
  details?: {
    cookiesCount: number;
    savedCookies: number;
    errors?: string[];
  };
}

export interface SyncContext {
  ownerUserId: string;
  ownerType: 'USER' | 'SYSTEM';
  timestamp: Date;
}
