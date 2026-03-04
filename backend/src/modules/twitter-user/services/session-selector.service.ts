/**
 * Session Selector Service - Phase 1.3
 * 
 * Единый селектор для выбора:
 * 1. Account пользователя (AUTO/MANUAL)
 * 2. Session (cookies) для account
 * 3. Proxy slot
 * 
 * Возвращает ParserRuntimeConfig для вызова twitter-parser-v2:5001
 */

import { UserTwitterAccountModel, type IUserTwitterAccount } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel, type IUserTwitterSession } from '../models/twitter-session.model.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { userScope } from '../acl/ownership.js';
import { ProxySlotService, type IProxySlot } from '../../twitter/slots/proxy-slot.service.js';
import type { CookieKV } from '../dto/twitter-webhook.dto.js';
import mongoose from 'mongoose';

// Import admin twitter account model for legacy/admin accounts
import { TwitterAccountModel } from '../../twitter/accounts/account.model.js';

// Initialize proxy service
const proxySlotService = new ProxySlotService();

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type SelectionMode = 'AUTO' | 'MANUAL';

export type SelectionReason =
  | 'NO_ACCOUNTS'
  | 'NO_SESSIONS'
  | 'ALL_SESSIONS_INVALID'
  | 'SESSION_EXPIRED'
  | 'NO_PROXY_AVAILABLE'
  | 'PREFERRED_ACCOUNT_UNAVAILABLE'
  | 'CONSENT_REQUIRED';

export type ScrollProfileHint = 'SAFE' | 'NORMAL' | 'AGGRESSIVE';

export interface ParserRuntimeConfig {
  ownerUserId: string;
  accountId: string;
  sessionId: string;
  cookies: CookieKV[];
  userAgent: string;
  proxy?: {
    host: string;
    port: number;
    protocol?: string;
    username?: string;
    password?: string;
  };
  scrollProfileHint?: ScrollProfileHint;
}

export interface SelectionMeta {
  mode: SelectionMode;
  chosenAccount: {
    id: string;
    username: string;
    isPreferred: boolean;
  };
  session: {
    id: string;
    version: number;
    status: string;
    riskScore: number;
    lastSyncAt?: Date;
    avgLatencyMs?: number;
  };
  proxy?: {
    id: string;
    name: string;
    host: string;
    port: number;
  };
  alternativeAccounts: number;
}

export interface SelectionResult {
  ok: boolean;
  reason?: SelectionReason;
  config?: ParserRuntimeConfig;
  meta?: SelectionMeta;
}

export interface SelectionOptions {
  /** Режим выбора (AUTO по умолчанию) */
  mode?: SelectionMode;
  /** Конкретный accountId (для MANUAL или force) */
  accountId?: string;
  /** Требовать proxy (default: false) */
  requireProxy?: boolean;
  /** Подсказка для scroll profile */
  scrollProfileHint?: ScrollProfileHint;
}

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

export class SessionSelectorService {
  constructor(private readonly crypto: CryptoService) {}

  /**
   * Основной метод - выбрать runtime config для парсинга
   */
  async selectForUser(
    ownerUserId: string,
    options: SelectionOptions = {}
  ): Promise<SelectionResult> {
    const {
      mode = 'AUTO',
      accountId: forceAccountId,
      requireProxy = false,
      scrollProfileHint,
    } = options;

    const scope = userScope(ownerUserId);

    // ═══════════════════════════════════════════════════════════════
    // Step 0: Get all user accounts + legacy/admin accounts
    // ═══════════════════════════════════════════════════════════════
    
    // First, get user's own accounts
    const userAccounts = await UserTwitterAccountModel.find({
      ...scope,
      enabled: true,
    }).lean();
    
    // Then, get legacy/admin accounts that have sessions for this user
    // This allows using admin-created accounts with user sessions
    const userSessionAccountIds = await UserTwitterSessionModel.distinct('accountId', {
      ownerUserId,
      isActive: true,
    });
    
    // Find admin accounts that match session accountIds
    const legacyAccountsQuery = {
      _id: { $in: userSessionAccountIds.map(id => new mongoose.Types.ObjectId(String(id))) },
      status: { $ne: 'DISABLED' },
    };
    const legacyAccounts = await TwitterAccountModel.find(legacyAccountsQuery).lean();
    
    // Convert legacy accounts to match IUserTwitterAccount interface
    const convertedLegacyAccounts: IUserTwitterAccount[] = legacyAccounts.map(a => ({
      _id: a._id,
      ownerUserId: ownerUserId, // Assign to current user for parsing
      username: a.username,
      displayName: a.displayName || a.username,
      enabled: a.status !== 'DISABLED',
      isPreferred: false,
      priority: 0,
      source: 'ADMIN' as const,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    } as IUserTwitterAccount));
    
    // Merge: user accounts first, then legacy accounts (avoiding duplicates)
    const userAccountIds = new Set(userAccounts.map(a => String(a._id)));
    const uniqueLegacyAccounts = convertedLegacyAccounts.filter(
      a => !userAccountIds.has(String(a._id))
    );
    
    const accounts = [...userAccounts, ...uniqueLegacyAccounts];
    
    console.log(`[SessionSelector] Found ${userAccounts.length} user accounts + ${uniqueLegacyAccounts.length} legacy accounts`);

    if (accounts.length === 0) {
      return { ok: false, reason: 'NO_ACCOUNTS' };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 1: Determine candidate accounts
    // ═══════════════════════════════════════════════════════════════
    let candidateAccounts: IUserTwitterAccount[];

    if (forceAccountId) {
      // Explicit account selection
      const forced = accounts.find(a => String(a._id) === forceAccountId);
      if (!forced) {
        return { ok: false, reason: 'NO_ACCOUNTS' };
      }
      candidateAccounts = [forced];
    } else if (mode === 'MANUAL') {
      // MANUAL mode: prefer preferred account
      const preferred = accounts.find(a => a.isPreferred);
      if (preferred) {
        candidateAccounts = [preferred, ...accounts.filter(a => !a.isPreferred)];
      } else {
        // No preferred set, fall back to AUTO
        candidateAccounts = accounts;
      }
    } else {
      // AUTO mode: all enabled accounts
      candidateAccounts = accounts;
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 2: For each account, get best session
    // ═══════════════════════════════════════════════════════════════
    const accountsWithSessions: Array<{
      account: IUserTwitterAccount;
      session: IUserTwitterSession;
    }> = [];

    let hasExpiredSession = false;

    for (const account of candidateAccounts) {
      const session = await this.getBestSessionForAccount(
        ownerUserId,
        String(account._id)
      );
      
      // Skip INVALID and EXPIRED sessions
      if (session) {
        if (session.status === 'EXPIRED') {
          hasExpiredSession = true;
          console.log(`[SessionSelector] Session ${session._id} is EXPIRED - needs resync`);
          continue; // Skip expired sessions
        }
        if (session.status !== 'INVALID') {
          accountsWithSessions.push({ account, session });
        }
      }
    }

    if (accountsWithSessions.length === 0) {
      // Check if there are any sessions at all
      const anySessions = await UserTwitterSessionModel.countDocuments({
        ...scope,
        isActive: true,
      });
      
      if (anySessions === 0) {
        return { ok: false, reason: 'NO_SESSIONS' };
      }
      
      // If we have expired sessions, return specific reason
      if (hasExpiredSession) {
        return { ok: false, reason: 'SESSION_EXPIRED' as SelectionReason };
      }
      
      return { ok: false, reason: 'ALL_SESSIONS_INVALID' };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 3: Rank accounts and pick winner
    // ═══════════════════════════════════════════════════════════════
    const ranked = this.rankAccountsWithSessions(accountsWithSessions, mode);
    const winner = ranked[0];

    // ═══════════════════════════════════════════════════════════════
    // Step 4: Select proxy slot (if needed/available)
    // ═══════════════════════════════════════════════════════════════
    let proxySlot: IProxySlot | null = null;
    
    try {
      proxySlot = await proxySlotService.selectBestSlot();
    } catch (err) {
      // Proxy service might not be available
      console.warn('[SessionSelector] Proxy selection failed:', err);
    }

    if (requireProxy && !proxySlot) {
      return { ok: false, reason: 'NO_PROXY_AVAILABLE' };
    }

    // ═══════════════════════════════════════════════════════════════
    // Step 5: Decrypt cookies and build config
    // ═══════════════════════════════════════════════════════════════
    let cookies: CookieKV[];
    try {
      const decrypted = this.crypto.decryptJson(
        winner.session.cookiesEnc,
        winner.session.cookiesIv,
        winner.session.cookiesTag
      );
      cookies = decrypted.cookies as CookieKV[];
    } catch (err) {
      console.error('[SessionSelector] Failed to decrypt cookies for session', winner.session._id, ':', err);
      
      // Mark session as INVALID due to decrypt failure
      await UserTwitterSessionModel.updateOne(
        { _id: winner.session._id },
        { 
          $set: { 
            status: 'INVALID',
            staleReason: 'DECRYPT_FAILED',
            staleAt: new Date()
          }
        }
      );
      console.log('[SessionSelector] Session marked as INVALID due to decrypt failure');
      
      return { ok: false, reason: 'ALL_SESSIONS_INVALID' };
    }

    // Build config
    const config: ParserRuntimeConfig = {
      ownerUserId,
      accountId: String(winner.account._id),
      sessionId: String(winner.session._id),
      cookies,
      userAgent: winner.session.userAgent || 'Mozilla/5.0',
      scrollProfileHint: scrollProfileHint || this.suggestScrollProfile(winner.session),
    };

    // Add proxy if available
    if (proxySlot) {
      config.proxy = {
        host: proxySlot.host,
        port: proxySlot.port,
        protocol: proxySlot.protocol,
        username: proxySlot.username,
        password: proxySlot.password,
      };
    }

    // Build meta
    const meta: SelectionMeta = {
      mode,
      chosenAccount: {
        id: String(winner.account._id),
        username: winner.account.username,
        isPreferred: !!winner.account.isPreferred,
      },
      session: {
        id: String(winner.session._id),
        version: winner.session.version,
        status: winner.session.status,
        riskScore: winner.session.riskScore,
        lastSyncAt: winner.session.lastSyncAt,
        avgLatencyMs: winner.session.avgLatencyMs,
      },
      alternativeAccounts: ranked.length - 1,
    };

    if (proxySlot) {
      meta.proxy = {
        id: String(proxySlot._id),
        name: proxySlot.name,
        host: proxySlot.host,
        port: proxySlot.port,
      };
    }

    return { ok: true, config, meta };
  }

  /**
   * Get selection for specific account
   */
  async selectForAccount(
    ownerUserId: string,
    accountId: string,
    options: Omit<SelectionOptions, 'accountId' | 'mode'> = {}
  ): Promise<SelectionResult> {
    return this.selectForUser(ownerUserId, {
      ...options,
      accountId,
      mode: 'MANUAL',
    });
  }

  /**
   * Get best session for account
   * Priority: OK > STALE, then by riskScore, lastSyncAt
   */
  private async getBestSessionForAccount(
    ownerUserId: string,
    accountId: string
  ): Promise<IUserTwitterSession | null> {
    const scope = userScope(ownerUserId);
    
    console.log('[DEBUG] SessionSelector v2 LOADED', {
      accountId,
      accountIdType: typeof accountId,
      isObjectId: mongoose.Types.ObjectId.isValid(accountId),
    });
    
    // Convert accountId string to ObjectId for proper Mongoose query
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    
    console.log('[DEBUG] Converted to ObjectId:', accountObjectId);

    // First try active OK session
    const okSession = await UserTwitterSessionModel.findOne({
      ...scope,
      accountId: accountObjectId,
      isActive: true,
      status: 'OK',
    })
    .sort({ lastSyncAt: -1, riskScore: 1 })
    .lean();
    
    console.log('[DEBUG] Found OK session:', okSession ? 'YES' : 'NO');

    if (okSession) return okSession;

    // Then try active STALE session
    const staleSession = await UserTwitterSessionModel.findOne({
      ...scope,
      accountId: accountObjectId,
      isActive: true,
      status: 'STALE',
    })
    .sort({ lastSyncAt: -1, riskScore: 1 })
    .lean();

    if (staleSession) return staleSession;

    // Finally any active session
    return UserTwitterSessionModel.findOne({
      ...scope,
      accountId: accountObjectId,
      isActive: true,
    })
    .sort({ lastSyncAt: -1 })
    .lean();
  }

  /**
   * Rank accounts with their sessions
   * 
   * Ranking rules (higher priority first):
   * 1. session.status: OK > STALE
   * 2. account.isPreferred (in MANUAL mode)
   * 3. lower riskScore
   * 4. fresher lastSyncAt
   * 5. lower avgLatencyMs
   * 6. higher priority
   */
  private rankAccountsWithSessions(
    items: Array<{ account: IUserTwitterAccount; session: IUserTwitterSession }>,
    mode: SelectionMode
  ): typeof items {
    return items.sort((a, b) => {
      // 1. Session status
      const statusOrder = { OK: 0, STALE: 1, INVALID: 2, ERROR: 3 };
      const statusDiff = statusOrder[a.session.status] - statusOrder[b.session.status];
      if (statusDiff !== 0) return statusDiff;

      // 2. Preferred account (in MANUAL mode)
      if (mode === 'MANUAL') {
        if (a.account.isPreferred && !b.account.isPreferred) return -1;
        if (!a.account.isPreferred && b.account.isPreferred) return 1;
      }

      // 3. Risk score (lower is better)
      const riskDiff = (a.session.riskScore || 0) - (b.session.riskScore || 0);
      if (riskDiff !== 0) return riskDiff;

      // 4. Last sync (fresher is better)
      const aSync = a.session.lastSyncAt?.getTime() || 0;
      const bSync = b.session.lastSyncAt?.getTime() || 0;
      if (aSync !== bSync) return bSync - aSync; // Descending

      // 5. Latency (lower is better)
      const latencyDiff = (a.session.avgLatencyMs || 0) - (b.session.avgLatencyMs || 0);
      if (latencyDiff !== 0) return latencyDiff;

      // 6. Priority (higher is better)
      const priorityDiff = (b.account.priority || 0) - (a.account.priority || 0);
      return priorityDiff;
    });
  }

  /**
   * Suggest scroll profile based on session telemetry
   */
  private suggestScrollProfile(session: IUserTwitterSession): ScrollProfileHint {
    // If high risk or recent abort -> SAFE
    if (session.riskScore > 50) return 'SAFE';
    
    const recentAbort = session.lastAbortAt && 
      (Date.now() - session.lastAbortAt.getTime() < 30 * 60 * 1000); // 30 min
    if (recentAbort) return 'SAFE';

    // If low latency and low risk -> AGGRESSIVE
    if ((session.avgLatencyMs || 0) < 1500 && session.riskScore < 20) {
      return 'AGGRESSIVE';
    }

    return 'NORMAL';
  }

  /**
   * Set preferred account for user (MANUAL mode)
   */
  async setPreferredAccount(
    ownerUserId: string,
    accountId: string
  ): Promise<void> {
    const scope = userScope(ownerUserId);

    // Clear all preferred flags for this user
    await UserTwitterAccountModel.updateMany(
      { ...scope },
      { $set: { isPreferred: false } }
    );

    // Set new preferred
    const result = await UserTwitterAccountModel.updateOne(
      { _id: accountId, ...scope },
      { $set: { isPreferred: true } }
    );

    if (result.matchedCount === 0) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }
  }

  /**
   * Clear preferred account (revert to AUTO)
   */
  async clearPreferredAccount(ownerUserId: string): Promise<void> {
    const scope = userScope(ownerUserId);
    
    await UserTwitterAccountModel.updateMany(
      { ...scope },
      { $set: { isPreferred: false } }
    );
  }

  /**
   * Get selection preview (what would be selected)
   * Does NOT decrypt cookies
   */
  async getSelectionPreview(
    ownerUserId: string,
    options: SelectionOptions = {}
  ): Promise<Omit<SelectionResult, 'config'> & { 
    config?: Omit<ParserRuntimeConfig, 'cookies'> 
  }> {
    const result = await this.selectForUser(ownerUserId, options);
    
    if (result.config) {
      // Remove cookies from preview
      const { cookies, ...configWithoutCookies } = result.config;
      return {
        ...result,
        config: {
          ...configWithoutCookies,
          // Indicate cookies would be present
        } as any,
      };
    }
    
    return result;
  }
}
