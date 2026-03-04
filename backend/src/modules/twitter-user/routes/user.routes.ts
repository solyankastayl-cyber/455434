/**
 * User-facing routes для Twitter интеграции
 * 
 * ПРАВИЛО: Роуты НЕ содержат бизнес-логику
 * Только вызов сервисов и форматирование ответа
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import type { IntegrationService } from '../services/integration.service.js';
import type { SessionService } from '../services/session.service.js';
import { TelegramNotifierV2 } from '../notifications/telegram-notifier.js';
import { integrationPolicyService } from '../services/integration-policy.service.js';

export async function registerTwitterUserRoutes(
  app: FastifyInstance,
  deps: {
    integration: IntegrationService;
    sessions: SessionService;
  }
) {
  // ============================================================
  // POLICY ROUTES (New versioned consent system)
  // ============================================================

  /**
   * GET /api/v4/integrations/twitter/policy
   * 
   * Get current policy with user's consent status
   */
  app.get('/api/v4/integrations/twitter/policy', async (req, reply) => {
    try {
      const u = requireUser(req);
      const data = await integrationPolicyService.getPolicyWithConsent(u.id, 'twitter-data-usage');
      return reply.send({ ok: true, data });
    } catch (err: any) {
      app.log.error(err, 'Failed to get policy');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/integrations/twitter/policy/accept
   * 
   * Accept current policy version
   */
  app.post('/api/v4/integrations/twitter/policy/accept', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as { version?: string };
      
      // Get current policy
      const policy = await integrationPolicyService.getActivePolicy('twitter-data-usage');
      if (!policy) {
        return reply.code(404).send({ ok: false, error: 'Policy not found' });
      }
      
      // Verify version matches if provided
      if (body.version && body.version !== policy.version) {
        return reply.code(400).send({ 
          ok: false, 
          error: 'Policy version mismatch. Please refresh and try again.',
          currentVersion: policy.version,
        });
      }
      
      const result = await integrationPolicyService.acceptConsent(u.id, 'twitter-data-usage', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });
      
      // Also update via legacy service for state resolver compatibility
      await deps.integration.acceptConsent(u.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });
      
      // Return updated status
      const status = await deps.integration.getStatus(u.id);
      
      return reply.send({ 
        ok: true, 
        data: {
          accepted: true,
          version: result.version,
          state: status.state,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Failed to accept policy');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/integrations/twitter/policy/revoke
   * 
   * Revoke consent (user-initiated)
   */
  app.delete('/api/v4/integrations/twitter/policy/revoke', async (req, reply) => {
    try {
      const u = requireUser(req);
      await integrationPolicyService.revokeConsent(u.id, 'twitter-data-usage', 'User requested');
      return reply.send({ ok: true, message: 'Consent revoked' });
    } catch (err: any) {
      app.log.error(err, 'Failed to revoke consent');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  // ============================================================
  // LEGACY ROUTES (kept for backward compatibility)
  // ============================================================

  /**
   * GET /api/v4/twitter/integration/status
   * 
   * Единственный endpoint для получения состояния
   * UI, Telegram, Extension используют ТОЛЬКО его
   */
  app.get('/api/v4/twitter/integration/status', async (req, reply) => {
    try {
      const u = requireUser(req);
      const data = await deps.integration.getStatus(u.id);
      return reply.send({ ok: true, data });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/consent
   * 
   * Принять согласие пользователя (LEGACY - redirects to new system)
   */
  app.post('/api/v4/twitter/consent', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as { accepted: boolean };
      
      if (!body.accepted) {
        return reply.code(400).send({
          ok: false,
          error: 'accepted must be true',
        });
      }

      // Use new policy service
      await integrationPolicyService.acceptConsent(u.id, 'twitter-data-usage', {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });
      
      // Also call legacy for state resolver
      await deps.integration.acceptConsent(u.id, {
        ip: req.ip,
        userAgent: req.headers['user-agent'] as string | undefined,
      });

      // Возвращаем новое состояние
      const status = await deps.integration.getStatus(u.id);
      return reply.send({ ok: true, state: status.state });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/session/summary
   * 
   * Сводка по сессии (алиас для /integration/status)
   */
  app.get('/api/v4/twitter/session/summary', async (req, reply) => {
    try {
      const u = requireUser(req);
      const data = await deps.integration.getStatus(u.id);
      return reply.send({ ok: true, data });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/telegram/link
   * 
   * Привязать Telegram chat ID для уведомлений
   */
  app.post('/api/v4/twitter/telegram/link', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as { chatId: string };
      
      if (!body.chatId) {
        return reply.code(400).send({
          ok: false,
          error: 'chatId is required',
        });
      }

      await deps.integration.setTelegramChatId(u.id, body.chatId);
      return reply.send({ ok: true });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/telegram/status
   * 
   * Получить статус Telegram подключения
   */
  app.get('/api/v4/twitter/telegram/status', async (req, reply) => {
    try {
      const u = requireUser(req);
      const info = await TelegramNotifierV2.getConnectionInfo(u.id);
      return reply.send({ ok: true, data: info });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/telegram/test
   * 
   * Отправить тестовое сообщение в Telegram
   */
  app.post('/api/v4/twitter/telegram/test', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      // Check if connection exists
      const hasConnection = await TelegramNotifierV2.hasConnection(u.id);
      if (!hasConnection) {
        return reply.code(400).send({
          ok: false,
          error: 'NO_TELEGRAM_CONNECTION',
          message: 'Please connect Telegram first',
        });
      }
      
      // Send test message
      const result = await TelegramNotifierV2.sendTestMessage(u.id);
      
      if (result.sent) {
        return reply.send({
          ok: true,
          delivered: true,
          message: 'Test message sent successfully',
        });
      } else {
        return reply.send({
          ok: false,
          delivered: false,
          error: result.error,
          message: result.error === 'NO_CONNECTION' 
            ? 'Telegram not connected' 
            : 'Failed to send message',
        });
      }
    } catch (err: any) {
      app.log.error(err, 'Telegram test error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/telegram/connect-link
   * 
   * Генерирует deep-link для подключения Telegram (P1 UX улучшение)
   * Возвращает ссылку вида t.me/bot?start=link_<token>
   */
  app.get('/api/v4/twitter/telegram/connect-link', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      // Generate unique token for this user
      const token = Buffer.from(`${u.id}:${Date.now()}`).toString('base64').replace(/[+/=]/g, '').slice(0, 16);
      
      // Store pending connection
      const { TelegramConnectionModel } = await import('../../../core/notifications/telegram.service.js');
      await TelegramConnectionModel.updateOne(
        { userId: u.id },
        { 
          $set: { 
            pendingLinkToken: token,
            pendingLinkExpires: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
          } 
        },
        { upsert: true }
      );
      
      const botUsername = process.env.TELEGRAM_USER_BOT_USERNAME || 't_fomo_bot';
      const deepLink = `https://t.me/${botUsername}?start=link_${token}`;
      
      return reply.send({
        ok: true,
        data: {
          link: deepLink,
          token,
          expiresIn: 600, // 10 minutes
          botUsername,
        },
      });
    } catch (err: any) {
      app.log.error(err, 'Telegram connect-link error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * DELETE /api/v4/twitter/telegram/unlink
   * 
   * Отключить Telegram уведомления
   */
  app.delete('/api/v4/twitter/telegram/unlink', async (req, reply) => {
    try {
      const u = requireUser(req);
      await deps.integration.removeTelegramChatId(u.id);
      return reply.send({ 
        ok: true,
        message: 'Telegram disconnected successfully'
      });
    } catch (err: any) {
      app.log.error(err, 'Telegram unlink error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/telegram/disconnect
   * 
   * Отключить Telegram уведомления
   */
  app.post('/api/v4/twitter/telegram/disconnect', async (req, reply) => {
    try {
      const u = requireUser(req);
      
      const disconnected = await TelegramNotifierV2.disconnect(u.id);
      
      if (disconnected) {
        return reply.send({
          ok: true,
          message: 'Telegram disconnected successfully',
        });
      } else {
        return reply.send({
          ok: false,
          error: 'NO_CONNECTION',
          message: 'No active Telegram connection to disconnect',
        });
      }
    } catch (err: any) {
      app.log.error(err, 'Telegram disconnect error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/telegram/events
   * 
   * Получить текущие настройки уведомлений
   */
  app.get('/api/v4/twitter/telegram/events', async (req, reply) => {
    try {
      const u = requireUser(req);
      const info = await TelegramNotifierV2.getConnectionInfo(u.id);
      
      if (!info.connected) {
        return reply.code(400).send({
          ok: false,
          error: 'NO_CONNECTION',
          message: 'Telegram not connected',
        });
      }
      
      return reply.send({
        ok: true,
        data: info.eventPreferences,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * PUT /api/v4/twitter/telegram/events
   * 
   * Обновить настройки уведомлений
   */
  app.put('/api/v4/twitter/telegram/events', async (req, reply) => {
    try {
      const u = requireUser(req);
      const body = (req.body ?? {}) as {
        sessionOk?: boolean;
        sessionStale?: boolean;
        sessionInvalid?: boolean;
        parseCompleted?: boolean;
        parseAborted?: boolean;
        cooldown?: boolean;
        highRisk?: boolean;
      };
      
      const result = await TelegramNotifierV2.updateEventPreferences(u.id, body);
      
      if (result.updated) {
        return reply.send({
          ok: true,
          data: result.eventPreferences,
          message: 'Event preferences updated',
        });
      } else {
        return reply.send({
          ok: false,
          error: 'UPDATE_FAILED',
          message: 'No active connection or invalid preferences',
        });
      }
    } catch (err: any) {
      app.log.error(err, 'Telegram events update error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
