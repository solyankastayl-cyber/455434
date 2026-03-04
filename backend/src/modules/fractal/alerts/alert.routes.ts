/**
 * BLOCK 68 — Alert Admin API Routes
 * 
 * Endpoints:
 * - GET /admin/alerts - List alerts with filters
 * - GET /admin/alerts/latest - Recent alerts
 * - GET /admin/alerts/quota - Quota status
 * - GET /admin/alerts/stats - Statistics
 * - POST /admin/alerts/check - Dry run (evaluate without sending)
 * - POST /admin/alerts/run - Production run (evaluate + send)
 */

import { FastifyInstance } from 'fastify';
import { AlertLogModel } from './alert.model.js';
import { getQuotaStatus, getAlertStats } from './alert.quota.service.js';
import { runAlertEngine, evaluateAlerts, type AlertEngineContext } from './alert.engine.service.js';
import { sendAlertsToTelegram } from './alert.tg.adapter.js';

export async function registerAlertRoutes(app: FastifyInstance) {
  const prefix = '/api/fractal/v2.1/admin/alerts';
  
  // ═══════════════════════════════════════════════════════════════
  // GET /admin/alerts - List alerts with filters
  // ═══════════════════════════════════════════════════════════════
  app.get(prefix, async (request) => {
    const query = request.query as {
      level?: string;
      type?: string;
      blockedBy?: string;
      from?: string;
      to?: string;
      limit?: string;
      cursor?: string;
    };
    
    const filter: any = { symbol: 'BTC' };
    
    if (query.level) filter.level = query.level;
    if (query.type) filter.type = query.type;
    if (query.blockedBy) filter.blockedBy = query.blockedBy;
    
    if (query.from || query.to) {
      filter.triggeredAt = {};
      if (query.from) filter.triggeredAt.$gte = new Date(query.from);
      if (query.to) filter.triggeredAt.$lte = new Date(query.to);
    }
    
    if (query.cursor) {
      filter._id = { $lt: query.cursor };
    }
    
    const limit = Math.min(Number(query.limit) || 50, 100);
    
    const items = await AlertLogModel.find(filter)
      .sort({ _id: -1 })
      .limit(limit)
      .lean();
    
    const nextCursor = items.length === limit
      ? items[items.length - 1]._id
      : null;
    
    const stats = await getAlertStats();
    const quota = await getQuotaStatus();
    
    return {
      items,
      nextCursor,
      stats,
      quota
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /admin/alerts/latest - Recent alerts (for widget)
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/latest`, async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Number(query.limit) || 5, 20);
    
    const items = await AlertLogModel.find({
      symbol: 'BTC',
      blockedBy: 'NONE'  // Only sent alerts
    })
      .sort({ triggeredAt: -1 })
      .limit(limit)
      .lean();
    
    return { items };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /admin/alerts/quota - Quota status
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/quota`, async () => {
    return await getQuotaStatus();
  });
  
  // ═══════════════════════════════════════════════════════════════
  // GET /admin/alerts/stats - Statistics
  // ═══════════════════════════════════════════════════════════════
  app.get(`${prefix}/stats`, async () => {
    const stats = await getAlertStats();
    const quota = await getQuotaStatus();
    
    return { stats, quota };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /admin/alerts/check - Dry run (evaluate without sending)
  // ═══════════════════════════════════════════════════════════════
  app.post(`${prefix}/check`, async (request) => {
    const body = (request.body || {}) as Partial<AlertEngineContext>;
    
    // Build context with defaults
    const ctx: AlertEngineContext = {
      symbol: 'BTC',
      current: body.current || {},
      previous: body.previous || {}
    };
    
    // Run engine without saving or sending
    const events = await evaluateAlerts(ctx);
    
    return {
      ok: true,
      dryRun: true,
      eventsCount: events.length,
      events
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /admin/alerts/run - Production run (evaluate + send)
  // ═══════════════════════════════════════════════════════════════
  app.post(`${prefix}/run`, async (request) => {
    const body = (request.body || {}) as Partial<AlertEngineContext>;
    
    // Build context with defaults
    const ctx: AlertEngineContext = {
      symbol: 'BTC',
      current: body.current || {},
      previous: body.previous || {}
    };
    
    // Run full alert engine
    const result = await runAlertEngine(ctx);
    
    // Send alerts via Telegram (respects FRACTAL_ALERTS_ENABLED)
    const tgResult = await sendAlertsToTelegram(result.events, app.log);
    
    return {
      ok: true,
      ...result,
      telegram: tgResult
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // POST /admin/alerts/test - Send test alert
  // ═══════════════════════════════════════════════════════════════
  app.post(`${prefix}/test`, async () => {
    const testEvent = {
      symbol: 'BTC' as const,
      type: 'REGIME_SHIFT' as const,
      level: 'INFO' as const,
      message: '🧪 Test Alert\nThis is a test notification from Fractal Alert System.',
      fingerprint: `BTC|TEST|${Date.now()}`,
      meta: { test: true },
      blockedBy: 'NONE' as const,
      triggeredAt: new Date()
    };
    
    const tgResult = await sendAlertsToTelegram([testEvent], console);
    
    return {
      ok: tgResult.sent > 0,
      telegram: tgResult
    };
  });
  
  app.log.info('[Fractal] Alert routes registered');
}
