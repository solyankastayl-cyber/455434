/**
 * FRACTAL OPS — Admin Operations Routes
 * 
 * Endpoints:
 * - POST /api/fractal/v2.1/admin/telegram/test - Test telegram
 * - POST /api/fractal/v2.1/admin/jobs/daily-run-tg - Daily job with telegram (secured)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  tgSendMessage,
  getTelegramConfig,
  buildTestMessage,
  requireCronAuth,
  runDailyWithTelegram
} from './index.js';
import { fractalDailyJobService } from '../jobs/fractal.daily.job.js';
import { shadowDivergenceService } from '../admin/shadow_divergence.service.js';

export async function registerOpsRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin';

  /**
   * POST /admin/telegram/test
   * Send test message to admin Telegram
   */
  fastify.post(`${prefix}/telegram/test`, async (req: FastifyRequest, reply: FastifyReply) => {
    const config = getTelegramConfig();
    
    if (!config.enabled) {
      return reply.status(400).send({
        error: 'TELEGRAM_NOT_CONFIGURED',
        message: 'TG_BOT_TOKEN or TG_ADMIN_CHAT_ID not set in environment'
      });
    }

    const testMsg = buildTestMessage();
    const result = await tgSendMessage(fastify.log, {
      token: config.token,
      chatId: config.chatId,
      text: testMsg
    });

    if (result.ok) {
      return { success: true, message: 'Test message sent to Telegram' };
    } else {
      return reply.status(500).send({
        error: 'TELEGRAM_SEND_FAILED',
        details: result.error
      });
    }
  });

  /**
   * GET /admin/telegram/status
   * Check Telegram configuration status
   */
  fastify.get(`${prefix}/telegram/status`, async (req: FastifyRequest, reply: FastifyReply) => {
    const config = getTelegramConfig();
    return {
      enabled: config.enabled,
      tokenConfigured: !!config.token,
      chatIdConfigured: !!config.chatId,
      chatId: config.chatId ? `***${config.chatId.slice(-4)}` : null
    };
  });

  /**
   * POST /admin/jobs/daily-run-tg
   * Daily job with Telegram notifications (CRON SECURED)
   * 
   * Requires: Authorization: Bearer FRACTAL_CRON_SECRET
   */
  fastify.post(`${prefix}/jobs/daily-run-tg`, async (req: FastifyRequest<{
    Body: { symbol?: string }
  }>, reply: FastifyReply) => {
    // Check cron auth
    try {
      requireCronAuth(req);
    } catch (err: any) {
      return reply.status(err.statusCode || 401).send({ error: err.message });
    }

    const symbol = req.body?.symbol || 'BTC';

    // Only BTC allowed in production
    if (symbol !== 'BTC') {
      return reply.status(400).send({
        error: 'SYMBOL_NOT_ALLOWED',
        message: 'Only BTC supported in production mode'
      });
    }

    const result = await runDailyWithTelegram({
      logger: fastify.log,
      symbol,
      dailyRun: async (s: string) => fractalDailyJobService.runDaily(s),
      getShadowDivergence: async (s: string) => shadowDivergenceService.getShadowDivergence(s)
    });

    return {
      success: result.ok,
      telegram: result.telegram,
      notifications: result.notifications,
      daily: result.daily,
      error: result.error
    };
  });

  /**
   * POST /admin/jobs/daily-run-tg-open
   * Daily job with Telegram (NO AUTH - for testing only)
   * Remove in production or add IP whitelist
   */
  fastify.post(`${prefix}/jobs/daily-run-tg-open`, async (req: FastifyRequest<{
    Body: { symbol?: string }
  }>, reply: FastifyReply) => {
    const symbol = req.body?.symbol || 'BTC';

    const result = await runDailyWithTelegram({
      logger: fastify.log,
      symbol,
      dailyRun: async (s: string) => fractalDailyJobService.runDaily(s),
      getShadowDivergence: async (s: string) => shadowDivergenceService.getShadowDivergence(s)
    });

    return {
      success: result.ok,
      telegram: result.telegram,
      notifications: result.notifications,
      daily: result.daily,
      error: result.error
    };
  });

  fastify.log.info('[Fractal] OPS routes registered (telegram + cron)');
}
