/**
 * A.2.1 - Twitter Account CRUD Routes
 * 
 * Управление Twitter аккаунтами пользователя (identity layer)
 * 
 * PHASE 2.3 FIX: Support both JWT auth (web UI) and API key auth (extension)
 * PHASE 2.4 FIX: Include legacy twitter_accounts for backward compatibility
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import mongoose from 'mongoose';
import { ApiKeyService } from '../services/api-key.service.js';
import { userScope } from '../acl/ownership.js';
import { UserTwitterAccountModel } from '../models/twitter-account.model.js';
import { UserTwitterSessionModel } from '../models/twitter-session.model.js';
import { requireUser } from '../auth/require-user.hook.js';

// Config
const MAX_ACCOUNTS_PER_USER = 3;
const apiKeyService = new ApiKeyService();

/**
 * Resolve user from either JWT session or API key
 * Supports both web UI (JWT) and extension (API key)
 */
async function resolveUser(req: FastifyRequest): Promise<{ id: string; isAdmin?: boolean } | null> {
  // First, try API key auth (for extension)
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer usr_')) {
    const apiKey = authHeader.slice(7);
    const result = await apiKeyService.validate(apiKey, 'twitter:cookies:write');
    if (result.valid && result.ownerUserId) {
      return { id: result.ownerUserId };
    }
  }
  
  // Fall back to JWT auth (for web UI)
  const u = (req as any).user;
  if (u?.id) {
    return { id: String(u.id), isAdmin: !!u.isAdmin };
  }
  
  // Dev fallback (same as requireUser)
  console.log('[Auth] resolveUser using dev user fallback');
  return { id: 'dev-user', isAdmin: true };
}

export async function registerAccountRoutes(app: FastifyInstance) {
  /**
   * GET /api/v4/twitter/accounts
   * 
   * Список всех Twitter аккаунтов пользователя
   * 
   * Auth: JWT (web) OR API Key (extension)
   * 
   * Query params:
   * - includeLegacy=true - включить аккаунты из admin layer (для расширения)
   */
  app.get('/api/v4/twitter/accounts', async (req, reply) => {
    try {
      const u = await resolveUser(req);
      
      if (!u) {
        return reply.code(401).send({
          ok: false,
          error: 'UNAUTHORIZED',
          message: 'Valid authentication required (JWT or API key)',
        });
      }
      
      const scope = userScope(u.id);
      const query = req.query as any;
      const includeLegacy = query.includeLegacy === 'true';

      // Fetch from NEW collection (user_twitter_accounts) - user-scoped
      const userAccounts = await UserTwitterAccountModel.find(scope)
        .sort({ isPreferred: -1, createdAt: 1 })
        .lean();

      let mergedAccounts = [...userAccounts];

      // Include legacy accounts only if explicitly requested (for extension)
      if (includeLegacy) {
        const legacyQuery = {
          $or: [
            { ownerUserId: u.id },
            { ownerUserId: { $exists: false } },
            { ownerUserId: null },
            { ownerUserId: '' },
          ],
          $and: [
            { enabled: { $ne: false } },
            { status: { $ne: 'DISABLED' } },
          ],
        };
        
        // Use direct collection access to avoid model conflicts
        const db = mongoose.connection.db;
        const legacyAccounts = await db.collection('twitter_accounts')
          .find(legacyQuery)
          .sort({ createdAt: 1 })
          .toArray();

        // Merge accounts, avoiding duplicates by username
        const seenUsernames = new Set(userAccounts.map(a => a.username?.toLowerCase()));
        
        for (const legacy of legacyAccounts) {
          const username = legacy.username?.toLowerCase();
          if (username && !seenUsernames.has(username)) {
            seenUsernames.add(username);
            mergedAccounts.push({
              ...legacy,
              ownerType: legacy.ownerUserId ? 'USER' : 'SYSTEM',
              isLegacy: true,
              source: 'admin',
            } as any);
          }
        }
      }

      // Get session status for each account
      const accountsWithSessions = await Promise.all(
        mergedAccounts.map(async (account: any) => {
          // Try new sessions collection first
          let sessions = await UserTwitterSessionModel.find({
            accountId: account._id,
            isActive: true,
          })
            .sort({ createdAt: -1 })
            .limit(1)
            .lean();

          // If no sessions found and this is a legacy account, try legacy sessions
          if (sessions.length === 0 && account.isLegacy) {
            // Use direct collection access to avoid model conflict
            const db = mongoose.connection.db;
            const legacySessions = await db.collection('twitter_sessions')
              .find({
                accountId: account._id,
                isActive: true,
              })
              .sort({ createdAt: -1 })
              .limit(1)
              .toArray();
            sessions = legacySessions as any[];
          }

          const session = sessions[0];

          return {
            id: String(account._id),
            username: account.username,
            displayName: account.displayName || account.username,
            enabled: account.enabled !== false,
            isPreferred: account.isPreferred || false,
            priority: account.priority || 0,
            sessionStatus: session ? session.status : 'NO_SESSION',
            sessionCount: sessions.length,
            createdAt: account.createdAt,
            isLegacy: account.isLegacy || false,
            source: account.isLegacy ? 'admin' : 'user',
          };
        })
      );

      return reply.send({
        ok: true,
        data: {
          accounts: accountsWithSessions,
          total: accountsWithSessions.length,
          limit: MAX_ACCOUNTS_PER_USER,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get accounts error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/accounts
   * 
   * Добавить новый Twitter аккаунт
   */
  app.post('/api/v4/twitter/accounts', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const body = req.body as any;

      // Validation
      if (!body.username || typeof body.username !== 'string') {
        return reply.code(400).send({
          ok: false,
          error: 'USERNAME_REQUIRED',
          message: 'Username is required',
        });
      }

      const username = body.username.toLowerCase().replace('@', '').trim();

      if (!username) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_USERNAME',
          message: 'Invalid username format',
        });
      }

      // Check limit
      const existingCount = await UserTwitterAccountModel.countDocuments(scope);

      if (existingCount >= MAX_ACCOUNTS_PER_USER) {
        return reply.code(403).send({
          ok: false,
          error: 'ACCOUNT_LIMIT_REACHED',
          message: `Your plan allows up to ${MAX_ACCOUNTS_PER_USER} Twitter accounts`,
          limit: MAX_ACCOUNTS_PER_USER,
        });
      }

      // Check duplicate
      const existing = await UserTwitterAccountModel.findOne({
        ...scope,
        username,
      });

      if (existing) {
        return reply.code(409).send({
          ok: false,
          error: 'ACCOUNT_ALREADY_EXISTS',
          message: `Account @${username} already added`,
        });
      }

      // Auto-set preferred if first account
      const isPreferred = existingCount === 0;

      // Create account
      const account = await UserTwitterAccountModel.create({
        ...scope,
        username,
        displayName: body.displayName || username,
        enabled: true,
        isPreferred,
        priority: 0,
      });

      return reply.code(201).send({
        ok: true,
        data: {
          accountId: account._id,
          username: account.username,
          displayName: account.displayName,
          enabled: account.enabled,
          isPreferred: account.isPreferred,
          status: 'NO_SESSION',
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Create account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * PATCH /api/v4/twitter/accounts/:id
   * 
   * Обновить аккаунт (displayName, priority)
   */
  app.patch('/api/v4/twitter/accounts/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { id } = req.params as any;
      const body = req.body as any;

      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: id,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      // Update allowed fields
      if (body.displayName !== undefined) {
        account.displayName = body.displayName;
      }

      if (body.priority !== undefined && typeof body.priority === 'number') {
        account.priority = body.priority;
      }

      await account.save();

      return reply.send({
        ok: true,
        data: {
          accountId: account._id,
          username: account.username,
          displayName: account.displayName,
          priority: account.priority,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Update account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // NOTE: POST /api/v4/twitter/accounts/:id/preferred is defined in runtime-selection.routes.ts

  /**
   * POST /api/v4/twitter/accounts/:id/disable
   * 
   * Disable аккаунт (не удалять)
   */
  app.post('/api/v4/twitter/accounts/:id/disable', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { id } = req.params as any;

      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: id,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      account.enabled = false;

      // If this was preferred, unset
      if (account.isPreferred) {
        account.isPreferred = false;

        // Set another account as preferred if exists
        const otherAccount = await UserTwitterAccountModel.findOne({
          ...scope,
          _id: { $ne: id },
          enabled: true,
        });

        if (otherAccount) {
          otherAccount.isPreferred = true;
          await otherAccount.save();
        }
      }

      await account.save();

      return reply.send({
        ok: true,
        data: {
          accountId: account._id,
          enabled: false,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Disable account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/accounts/:id/enable
   * 
   * Enable аккаунт обратно
   */
  app.post('/api/v4/twitter/accounts/:id/enable', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { id } = req.params as any;

      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: id,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      account.enabled = true;
      await account.save();

      return reply.send({
        ok: true,
        data: {
          accountId: account._id,
          enabled: true,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Enable account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/twitter/accounts/:id
   * 
   * Удалить аккаунт и автоматически деактивировать все связанные сессии
   */
  app.delete('/api/v4/twitter/accounts/:id', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { id } = req.params as any;

      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: id,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      // Деактивируем все сессии перед удалением аккаунта
      const deactivatedSessions = await UserTwitterSessionModel.updateMany(
        { ...scope, accountId: id, isActive: true },
        { $set: { isActive: false, status: 'DELETED' } }
      );

      app.log.info(`Deactivated ${deactivatedSessions.modifiedCount} sessions for account ${id}`);

      // Удаляем аккаунт
      await account.deleteOne();

      return reply.send({
        ok: true,
        data: {
          accountId: id,
          deleted: true,
          sessionsDeactivated: deactivatedSessions.modifiedCount,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Delete account error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // ============================================================
  // A.2.2 - Sessions API
  // ============================================================

  /**
   * GET /api/v4/twitter/accounts/:accountId/sessions
   * 
   * Список всех сессий для конкретного аккаунта
   */
  app.get('/api/v4/twitter/accounts/:accountId/sessions', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { accountId } = req.params as { accountId: string };
      const query = req.query as { onlyActive?: string };

      // Verify account ownership
      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: accountId,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      // Build filter
      const filter: any = {
        ...scope,
        accountId,
      };

      if (query.onlyActive === 'true') {
        filter.isActive = true;
      }

      // Get sessions
      const sessions = await UserTwitterSessionModel.find(filter)
        .sort({ isActive: -1, updatedAt: -1 })
        .limit(50)
        .lean();

      // Map to DTO (exclude encrypted fields)
      const sessionsDto = sessions.map(s => ({
        id: s._id,
        accountId: s.accountId,
        version: s.version,
        isActive: s.isActive,
        status: s.status,
        riskScore: s.riskScore,
        lifetimeDaysEstimate: s.lifetimeDaysEstimate,
        lastOkAt: s.lastOkAt,
        lastSyncAt: s.lastSyncAt,
        lastAbortAt: s.lastAbortAt,
        staleReason: s.staleReason,
        avgLatencyMs: s.avgLatencyMs,
        successRate: s.successRate,
        userAgentShort: s.userAgent ? s.userAgent.substring(0, 50) + '...' : null,
        source: s.userAgent?.includes('Extension') ? 'EXTENSION' : 
                s.userAgent?.includes('Mock') ? 'MOCK' : 'MANUAL',
        supersededAt: s.supersededAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }));

      return reply.send({
        ok: true,
        data: {
          accountId,
          accountUsername: account.username,
          sessions: sessionsDto,
          total: sessionsDto.length,
          activeCount: sessionsDto.filter(s => s.isActive).length,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get sessions error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/accounts/:accountId/sessions/refresh-hint
   * 
   * Информация для refresh cookies flow
   */
  app.get('/api/v4/twitter/accounts/:accountId/sessions/refresh-hint', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { accountId } = req.params as { accountId: string };

      // Verify account ownership
      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: accountId,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      // Get current active session info
      const activeSession = await UserTwitterSessionModel.findOne({
        ...scope,
        accountId,
        isActive: true,
      }).lean();

      // Get webhook URL from env
      const webhookBaseUrl = process.env.APP_URL || 'https://your-app.com';

      return reply.send({
        ok: true,
        data: {
          accountId,
          accountUsername: account.username,
          currentStatus: activeSession?.status || 'NO_SESSION',
          currentVersion: activeSession?.version || 0,
          lastSyncAt: activeSession?.lastSyncAt || null,
          riskScore: activeSession?.riskScore || 0,
          staleReason: activeSession?.staleReason || null,
          // Refresh flow info
          webhookUrl: `${webhookBaseUrl}/api/v4/twitter/webhook/sync`,
          apiKeyRequired: true,
          apiKeyPageUrl: '/settings/api-keys',
          steps: [
            'Open Twitter in your browser and make sure you are logged in',
            'Open the AI-ON Chrome Extension',
            'Click "Sync Cookies" button',
            'Wait for confirmation',
          ],
          extensionInfo: {
            name: 'AI-ON Twitter Extension',
            chromeStoreUrl: null, // TODO: add when published
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get refresh hint error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/accounts/:accountId/sessions/:sessionId
   * 
   * Детали конкретной сессии
   */
  app.get('/api/v4/twitter/accounts/:accountId/sessions/:sessionId', async (req, reply) => {
    try {
      const u = requireUser(req);
      const scope = userScope(u.id);
      const { accountId, sessionId } = req.params as { accountId: string; sessionId: string };

      // Verify account ownership
      const account = await UserTwitterAccountModel.findOne({
        ...scope,
        _id: accountId,
      });

      if (!account) {
        return reply.code(404).send({
          ok: false,
          error: 'ACCOUNT_NOT_FOUND',
        });
      }

      const session = await UserTwitterSessionModel.findOne({
        ...scope,
        _id: sessionId,
        accountId,
      }).lean();

      if (!session) {
        return reply.code(404).send({
          ok: false,
          error: 'SESSION_NOT_FOUND',
        });
      }

      return reply.send({
        ok: true,
        data: {
          id: session._id,
          accountId: session.accountId,
          accountUsername: account.username,
          version: session.version,
          isActive: session.isActive,
          status: session.status,
          riskScore: session.riskScore,
          lifetimeDaysEstimate: session.lifetimeDaysEstimate,
          lastOkAt: session.lastOkAt,
          lastSyncAt: session.lastSyncAt,
          lastAbortAt: session.lastAbortAt,
          staleReason: session.staleReason,
          avgLatencyMs: session.avgLatencyMs,
          successRate: session.successRate,
          userAgentShort: session.userAgent ? session.userAgent.substring(0, 100) : null,
          source: session.userAgent?.includes('Extension') ? 'EXTENSION' : 
                  session.userAgent?.includes('Mock') ? 'MOCK' : 'MANUAL',
          supersededAt: session.supersededAt,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get session details error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
