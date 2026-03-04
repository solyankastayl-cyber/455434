/**
 * Session Service - Phase 1.2: Session Versioning & Rotation
 * 
 * ИНВАРИАНТЫ:
 * - cookies нельзя писать без ownerUserId
 * - нельзя писать cookies в account, который не принадлежит user
 * - нельзя overwrite активную сессию без versioning
 * - webhook не может делать INVALID (только OK или STALE)
 * 
 * NOTE: Используем атомарные операции вместо транзакций для совместимости 
 * с standalone MongoDB
 */

import { TwitterConsentModel } from '../models/twitter-consent.model.js';
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel, type IUserTwitterSession } from '../models/twitter-session.model.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { userScope } from '../acl/ownership.js';
import type { CookieWebhookDTO, CookieKV } from '../dto/twitter-webhook.dto.js';
import mongoose from 'mongoose';

/**
 * Extract core auth cookies and validate
 */
function extractCoreCookies(cookies: CookieKV[]): { 
  hasAuth: boolean; 
  hasCt0: boolean;
  isValid: boolean;
} {
  const auth = cookies.find((c) => c.name === 'auth_token');
  const ct0 = cookies.find((c) => c.name === 'ct0');
  const hasAuth = !!auth?.value;
  const hasCt0 = !!ct0?.value;
  return { 
    hasAuth, 
    hasCt0, 
    isValid: hasAuth && hasCt0 
  };
}

export interface WebhookResult {
  accountId: string;
  sessionId: string;
  sessionVersion: number;
  status: string;
  previousSessionDeactivated: boolean;
}

export class SessionService {
  constructor(private readonly crypto: CryptoService) {}

  /**
   * Ingest webhook from Chrome Extension
   * 
   * Phase 1.2 Algorithm (without transactions for standalone MongoDB):
   * 1. Check consent
   * 2. Validate account ownership (CRITICAL security check)
   * 3. Find and deactivate current active session (atomic updateMany)
   * 4. Create new session with incremented version
   */
  async ingestWebhook(
    ownerUserId: string,
    dto: CookieWebhookDTO
  ): Promise<WebhookResult> {
    // 1. Check consent
    const consent = await TwitterConsentModel.findOne({ 
      ownerUserId 
    }).lean();
    
    if (!consent?.accepted) {
      throw new Error('CONSENT_REQUIRED');
    }

    // 2. Validate account exists (Phase 1.2.3 - Check #1)
    // First try new collection (user_twitter_accounts)
    let account = await UserTwitterAccountModel.findById(dto.accountId).lean();
    
    // If not found, try legacy collection (twitter_accounts)
    if (!account) {
      const db = mongoose.connection.db;
      const legacyAccount = await db.collection('twitter_accounts').findOne({
        _id: new mongoose.Types.ObjectId(dto.accountId)
      });
      if (legacyAccount) {
        account = legacyAccount as any;
      }
    }
    
    if (!account) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }

    // 3. Validate account ownership (Phase 1.2.3 - Check #2) - CRITICAL
    // For legacy accounts without ownerUserId, allow access
    if (account.ownerUserId && account.ownerUserId !== ownerUserId) {
      throw new Error('ACCOUNT_OWNERSHIP_VIOLATION');
    }

    const accountId = String(account._id);
    const scope = userScope(ownerUserId);

    // 4. Validate cookies structure
    const { isValid, hasAuth, hasCt0 } = extractCoreCookies(dto.cookies);
    
    // Encrypt cookies (Phase 1.2.6 - Encryption boundary)
    const enc = this.crypto.encryptJson({ cookies: dto.cookies });

    // Determine status (webhook can only set OK or STALE, never INVALID)
    const nextStatus = isValid ? 'OK' : 'STALE';
    const staleReason = isValid 
      ? undefined 
      : `Missing: ${!hasAuth ? 'auth_token ' : ''}${!hasCt0 ? 'ct0' : ''}`.trim();

    // 5. Session Versioning (Phase 1.2.5)
    // Step 5.1: Get current max version (for increment)
    const currentSession = await UserTwitterSessionModel.findOne({
      accountId,
      isActive: true,
    }).lean();

    const previousVersion = currentSession?.version ?? 0;
    const newVersion = previousVersion + 1;

    // Step 5.2: Deactivate ALL active sessions for this account (atomic)
    // This handles any potential race conditions
    const deactivateResult = await UserTwitterSessionModel.updateMany(
      { accountId, isActive: true },
      { 
        $set: { 
          isActive: false, 
          supersededAt: new Date() 
        } 
      }
    );
    
    const previousSessionDeactivated = deactivateResult.modifiedCount > 0;

    // Step 5.3: Create new active session
    const newSession = await UserTwitterSessionModel.create({
      ...scope,
      accountId,
      version: newVersion,
      isActive: true,
      status: nextStatus,
      staleReason,
      riskScore: 0,
      lifetimeDaysEstimate: 14,
      cookiesEnc: enc.enc,
      cookiesIv: enc.iv,
      cookiesTag: enc.tag,
      lastSyncAt: new Date(),
      lastOkAt: isValid ? new Date() : undefined,
      userAgent: dto.userAgent,
      consentAt: consent.acceptedAt,
    });

    // TODO (Phase 1.7): IntegrationStateResolver.recompute(ownerUserId)
    // TODO (Phase 1.4): Telegram notification if state changed

    return {
      accountId,
      sessionId: String(newSession._id),
      sessionVersion: newVersion,
      status: nextStatus,
      previousSessionDeactivated,
    };
  }

  /**
   * Get decrypted cookies for parser runtime
   * Only returns cookies from ACTIVE session
   */
  async getDecryptedCookiesForRuntime(
    userId: string,
    accountId: string
  ): Promise<CookieKV[]> {
    const scope = userScope(userId);
    
    // Only get active session
    const session = await UserTwitterSessionModel.findOne({ 
      ...scope, 
      accountId,
      isActive: true 
    }).lean();
    
    if (!session) {
      throw new Error('SESSION_NOT_FOUND');
    }

    if (session.status === 'INVALID') {
      throw new Error('SESSION_INVALID');
    }
    
    if (session.status === 'EXPIRED') {
      throw new Error('SESSION_EXPIRED');
    }

    // Try to decrypt cookies
    try {
      const payload = this.crypto.decryptJson(
        session.cookiesEnc,
        session.cookiesIv,
        session.cookiesTag
      );
      
      return payload.cookies as CookieKV[];
    } catch (decryptError) {
      // Decryption failed - mark session as INVALID
      console.error(`[SessionService] Cookie decryption failed for session ${session._id}:`, decryptError);
      
      await UserTwitterSessionModel.updateOne(
        { _id: session._id },
        { 
          $set: { 
            status: 'INVALID',
            staleReason: 'DECRYPT_FAILED',
            staleAt: new Date()
          }
        }
      );
      
      throw new Error('SESSION_DECRYPT_FAILED');
    }
  }

  /**
   * Get active session for account
   */
  async getActiveSession(
    userId: string,
    accountId: string
  ): Promise<IUserTwitterSession | null> {
    return UserTwitterSessionModel.findOne({
      ...userScope(userId),
      accountId,
      isActive: true,
    });
  }

  /**
   * Get session history for account (all versions)
   */
  async getSessionHistory(
    userId: string,
    accountId: string,
    limit: number = 10
  ): Promise<IUserTwitterSession[]> {
    return UserTwitterSessionModel.find({
      ...userScope(userId),
      accountId,
    })
    .sort({ version: -1 })
    .limit(limit)
    .lean();
  }

  /**
   * Mark session as STALE (from parser runtime feedback)
   * Note: Only parser can mark as STALE, webhook cannot change to INVALID
   */
  async markSessionStale(
    sessionId: string,
    reason: string
  ): Promise<void> {
    await UserTwitterSessionModel.updateOne(
      { _id: sessionId, isActive: true },
      { 
        $set: { 
          status: 'STALE', 
          staleReason: reason,
          updatedAt: new Date()
        } 
      }
    );
  }
}
