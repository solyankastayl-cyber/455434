/**
 * BLOCK E.4 — Hardened OPS Routes
 * 
 * Endpoints с улучшенной защитой:
 * - /admin/telegram/health - статус TG сервиса
 * - /admin/telegram/stats - статистика отправок
 * - /admin/cron/status - статус крон джобов
 * - /admin/cron/history - история выполнений
 * - /admin/jobs/daily-run-hardened - hardened daily job
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  TelegramHardenedService,
  initTelegramHardened,
  getTelegramHardenedService,
} from './telegram.hardened.js';
import {
  CronHardeningService,
  initCronHardening,
  getCronHardeningService,
} from './cron.hardening.js';
import { getTelegramConfig, requireCronAuth } from './index.js';
import { fractalDailyJobService } from '../jobs/fractal.daily.job.js';
import { buildDailyReport } from './telegram.messages.js';
import {
  buildCronTimeoutAlert,
  buildStartupNotification,
} from './telegram.alerts.extended.js';

// ═══════════════════════════════════════════════════════════════
// INIT SERVICES
// ═══════════════════════════════════════════════════════════════

let tgService: TelegramHardenedService | null = null;
let cronService: CronHardeningService | null = null;

function ensureServices(logger?: any): void {
  const tgConfig = getTelegramConfig();

  if (!tgService && tgConfig.enabled) {
    tgService = initTelegramHardened({
      token: tgConfig.token,
      chatId: tgConfig.chatId,
      maxRetries: 3,
      baseDelayMs: 1000,
      rateLimit: { maxPerMinute: 10, maxPerHour: 60 },
      logger,
    });
  }

  if (!cronService) {
    cronService = initCronHardening({
      lockTimeoutMs: 300_000,
      executionTimeoutMs: 600_000,
      logger,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerHardenedOpsRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/v2.1/admin';

  // Initialize services
  ensureServices(fastify.log);

  /**
   * GET /admin/telegram/health
   * Check Telegram service health
   */
  fastify.get(`${prefix}/telegram/health`, async (req, reply) => {
    const config = getTelegramConfig();

    if (!config.enabled) {
      return {
        ok: false,
        status: 'NOT_CONFIGURED',
        message: 'Telegram not configured',
      };
    }

    if (!tgService) {
      return {
        ok: false,
        status: 'NOT_INITIALIZED',
        message: 'TelegramHardenedService not initialized',
      };
    }

    const stats = tgService.getStats();
    const recentFailures = stats.failuresLastHour;

    return {
      ok: recentFailures < 5,
      status: recentFailures === 0 ? 'HEALTHY' : recentFailures < 5 ? 'DEGRADED' : 'UNHEALTHY',
      stats,
      chatIdMasked: `***${config.chatId.slice(-4)}`,
    };
  });

  /**
   * GET /admin/telegram/stats
   * Get Telegram sending statistics
   */
  fastify.get(`${prefix}/telegram/stats`, async (req, reply) => {
    if (!tgService) {
      return reply.status(503).send({ error: 'Service not initialized' });
    }

    return {
      stats: tgService.getStats(),
      auditLog: tgService.getAuditLog(20),
    };
  });

  /**
   * POST /admin/telegram/test-hardened
   * Send test message through hardened service
   */
  fastify.post(`${prefix}/telegram/test-hardened`, async (req, reply) => {
    if (!tgService) {
      return reply.status(503).send({ error: 'Service not initialized' });
    }

    const result = await tgService.send(
      `🧪 <b>HARDENED TEST</b>\n\nTimestamp: ${new Date().toISOString()}\nService: TelegramHardenedService`,
      'INFO'
    );

    return {
      success: result.ok,
      result,
    };
  });

  /**
   * GET /admin/cron/status
   * Get cron service status
   */
  fastify.get(`${prefix}/cron/status`, async (req, reply) => {
    if (!cronService) {
      return reply.status(503).send({ error: 'Service not initialized' });
    }

    const stats = cronService.getStats();
    const dailyLock = cronService.getLockStatus('fractal-daily');

    return {
      ok: true,
      stats,
      locks: {
        'fractal-daily': dailyLock,
      },
    };
  });

  /**
   * GET /admin/cron/history
   * Get cron execution history
   */
  fastify.get<{ Querystring: { job?: string; limit?: string } }>(
    `${prefix}/cron/history`,
    async (req, reply) => {
      if (!cronService) {
        return reply.status(503).send({ error: 'Service not initialized' });
      }

      const { job, limit } = req.query;
      const history = cronService.getExecutionHistory(job, Number(limit) || 50);

      return { history };
    }
  );

  /**
   * POST /admin/jobs/daily-run-hardened
   * Daily job with full hardening (CRON SECURED)
   */
  fastify.post<{ Body: { symbol?: string } }>(
    `${prefix}/jobs/daily-run-hardened`,
    async (req, reply) => {
      // Auth check
      try {
        requireCronAuth(req);
      } catch (err: any) {
        return reply.status(err.statusCode || 401).send({ error: err.message });
      }

      if (!cronService || !tgService) {
        return reply.status(503).send({ error: 'Services not initialized' });
      }

      const symbol = req.body?.symbol || 'BTC';

      // Only BTC allowed
      if (symbol !== 'BTC') {
        return reply.status(400).send({ error: 'Only BTC supported' });
      }

      // Generate idempotency key
      const idempotencyKey = cronService.generateDailyKey('fractal-daily', symbol);

      // Execute with hardening
      const cronResult = await cronService.executeWithHardening(
        'fractal-daily',
        idempotencyKey,
        async () => {
          // Run the actual job
          const jobResult = await fractalDailyJobService.runDaily(symbol);

          // Send telegram notification
          if (tgService) {
            const dailyPayload = {
              asofDate: jobResult?.asofDate || new Date().toISOString().slice(0, 10),
              symbol,
              steps: jobResult?.steps || {},
              health: { level: 'WATCH' as const, reasons: [] },
              reliability: { badge: 'UNKNOWN', score: 0 },
              resolvedCount: 0,
              governanceMode: 'NORMAL',
            };

            const dailyText = buildDailyReport(dailyPayload);
            await tgService.send(dailyText, 'INFO');
          }

          return jobResult;
        }
      );

      // If timeout, send alert
      if (cronResult.error === 'EXECUTION_TIMEOUT' && tgService) {
        const timeoutAlert = buildCronTimeoutAlert({
          jobName: 'fractal-daily',
          executionId: cronResult.jobId,
          startedAt: cronResult.startedAt,
          timeoutAfterMs: 600_000,
        });
        await tgService.sendCritical(timeoutAlert);
      }

      return {
        success: cronResult.ok,
        jobId: cronResult.jobId,
        skipped: cronResult.skipped,
        skipReason: cronResult.skipReason,
        durationMs: cronResult.durationMs,
        error: cronResult.error,
      };
    }
  );

  /**
   * POST /admin/notify/startup
   * Send startup notification (for init scripts)
   */
  fastify.post(`${prefix}/notify/startup`, async (req, reply) => {
    if (!tgService) {
      return reply.status(503).send({ error: 'Service not initialized' });
    }

    const startupMsg = buildStartupNotification({
      version: 'v2.1.0',
      environment: process.env.NODE_ENV || 'development',
      instanceId: cronService?.['config']?.instanceId || 'unknown',
      enabledFeatures: [
        'Contract Freeze',
        'Telegram Hardened',
        'Cron Hardening',
        'Daily Jobs',
      ],
    });

    const result = await tgService.send(startupMsg, 'INFO');

    return { success: result.ok, result };
  });

  fastify.log.info('[Fractal] Hardened OPS routes registered');
}
