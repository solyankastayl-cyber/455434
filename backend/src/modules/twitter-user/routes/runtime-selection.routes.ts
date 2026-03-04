/**
 * Runtime Selection Routes - Phase 1.3
 * 
 * API endpoints для:
 * - Получить текущий выбор системы (preview)
 * - Установить preferred account (MANUAL mode)
 * - Переключить режим AUTO/MANUAL
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { SessionSelectorService, type SelectionMode } from '../services/session-selector.service.js';
import { CryptoService } from '../crypto/crypto.service.js';

export async function registerRuntimeSelectionRoutes(app: FastifyInstance) {
  // Initialize service with crypto
  const cookieEncKey = process.env.COOKIE_ENC_KEY || '';
  const crypto = new CryptoService(cookieEncKey);
  const selectorService = new SessionSelectorService(crypto);

  /**
   * GET /api/v4/twitter/runtime/selection
   * 
   * Получить preview того, что выберет система
   * НЕ возвращает cookies (безопасно для UI)
   */
  app.get('/api/v4/twitter/runtime/selection', async (req, reply) => {
    try {
      const u = requireUser(req);
      const query = req.query as { mode?: SelectionMode };
      
      const result = await selectorService.getSelectionPreview(u.id, {
        mode: query.mode,
      });

      return reply.send({
        ok: result.ok,
        reason: result.reason,
        selection: result.ok ? {
          account: result.meta?.chosenAccount,
          session: result.meta?.session,
          proxy: result.meta?.proxy,
          mode: result.meta?.mode,
          alternativeAccounts: result.meta?.alternativeAccounts,
          scrollProfileHint: (result.config as any)?.scrollProfileHint,
        } : undefined,
      });
    } catch (err: any) {
      app.log.error(err, 'Selection preview error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/runtime/selection/full
   * 
   * Получить полный runtime config (включая cookies)
   * ТОЛЬКО для internal parser calls
   */
  app.get('/api/v4/twitter/runtime/selection/full', async (req, reply) => {
    try {
      const u = requireUser(req);
      const query = req.query as { 
        mode?: SelectionMode;
        accountId?: string;
        requireProxy?: string;
      };
      
      const result = await selectorService.selectForUser(u.id, {
        mode: query.mode,
        accountId: query.accountId,
        requireProxy: query.requireProxy === 'true',
      });

      if (!result.ok) {
        return reply.code(400).send({
          ok: false,
          reason: result.reason,
        });
      }

      return reply.send({
        ok: true,
        config: result.config,
        meta: result.meta,
      });
    } catch (err: any) {
      app.log.error(err, 'Selection full error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/accounts/:id/preferred
   * 
   * Установить preferred account (MANUAL mode)
   */
  app.post('/api/v4/twitter/accounts/:id/preferred', async (req, reply) => {
    try {
      const u = requireUser(req);
      const { id } = req.params as { id: string };
      const body = (req.body ?? {}) as { isPreferred?: boolean };

      if (body.isPreferred === false) {
        // Clear preferred status
        await selectorService.clearPreferredAccount(u.id);
        return reply.send({ 
          ok: true, 
          message: 'Preferred account cleared, using AUTO mode' 
        });
      }

      // Set as preferred
      await selectorService.setPreferredAccount(u.id, id);
      
      return reply.send({ 
        ok: true, 
        message: 'Account set as preferred for MANUAL mode',
        accountId: id,
      });
    } catch (err: any) {
      if (err.message === 'ACCOUNT_NOT_FOUND') {
        return reply.code(404).send({ 
          ok: false, 
          error: 'Account not found or does not belong to user' 
        });
      }
      app.log.error(err, 'Set preferred error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/twitter/accounts/preferred
   * 
   * Очистить preferred account (вернуться к AUTO)
   */
  app.delete('/api/v4/twitter/accounts/preferred', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      await selectorService.clearPreferredAccount(u.id);
      
      return reply.send({ 
        ok: true, 
        message: 'Preferred account cleared, now using AUTO mode' 
      });
    } catch (err: any) {
      app.log.error(err, 'Clear preferred error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/accounts/preferred
   * 
   * Получить текущий preferred account
   */
  app.get('/api/v4/twitter/accounts/preferred', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      const { UserTwitterAccountModel } = await import('../models/twitter-account.model.js');
      const { userScope } = await import('../acl/ownership.js');
      
      const preferred = await UserTwitterAccountModel.findOne({
        ...userScope(u.id),
        isPreferred: true,
      }).lean();

      if (!preferred) {
        return reply.send({
          ok: true,
          mode: 'AUTO',
          preferred: null,
        });
      }

      return reply.send({
        ok: true,
        mode: 'MANUAL',
        preferred: {
          id: String(preferred._id),
          username: preferred.username,
          displayName: preferred.displayName,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Get preferred error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/runtime/candidates
   * 
   * Получить список всех доступных аккаунтов с их сессиями
   * Полезно для UI выбора
   */
  app.get('/api/v4/twitter/runtime/candidates', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      const { UserTwitterAccountModel } = await import('../models/twitter-account.model.js');
      const { UserTwitterSessionModel } = await import('../models/twitter-session.model.js');
      const { userScope } = await import('../acl/ownership.js');
      
      const scope = userScope(u.id);
      
      // Get all enabled accounts
      const accounts = await UserTwitterAccountModel.find({
        ...scope,
        enabled: true,
      }).lean();

      // For each account, get active session info
      const candidates = await Promise.all(accounts.map(async (acc) => {
        const session = await UserTwitterSessionModel.findOne({
          ...scope,
          accountId: String(acc._id),
          isActive: true,
        }).lean();

        return {
          account: {
            id: String(acc._id),
            username: acc.username,
            displayName: acc.displayName,
            isPreferred: acc.isPreferred || false,
            priority: acc.priority || 0,
          },
          session: session ? {
            id: String(session._id),
            version: session.version,
            status: session.status,
            riskScore: session.riskScore,
            lastSyncAt: session.lastSyncAt,
            avgLatencyMs: session.avgLatencyMs,
          } : null,
          canParse: session && session.status !== 'INVALID',
        };
      }));

      // Sort: preferred first, then by status, then by riskScore
      candidates.sort((a, b) => {
        if (a.account.isPreferred && !b.account.isPreferred) return -1;
        if (!a.account.isPreferred && b.account.isPreferred) return 1;
        
        if (a.canParse && !b.canParse) return -1;
        if (!a.canParse && b.canParse) return 1;
        
        const statusOrder: Record<string, number> = { OK: 0, STALE: 1, INVALID: 2 };
        const aStatus = a.session?.status || 'INVALID';
        const bStatus = b.session?.status || 'INVALID';
        
        return (statusOrder[aStatus] || 3) - (statusOrder[bStatus] || 3);
      });

      return reply.send({
        ok: true,
        data: {
          candidates,
          stats: {
            total: candidates.length,
            canParse: candidates.filter(c => c.canParse).length,
            withOkSession: candidates.filter(c => c.session?.status === 'OK').length,
            withPreferred: candidates.filter(c => c.account.isPreferred).length,
          },
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Candidates error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
