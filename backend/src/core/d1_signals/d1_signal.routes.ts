/**
 * EPIC D1 — Engine Signals Routes
 * 
 * API Contract v1.0 for /api/d1-signals
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as service from './d1_signal.service.js';
import * as engine from './d1_signal.engine.js';
import { runSignalEngineV2, getLastRunV2 } from './d1_signal.engine_v2.js';
import * as telegram from './d1_telegram.dispatcher.js';
import * as telegramLink from './d1_telegram_link.service.js';
import type { D1SignalQuery, D1Window, D1Status, D1SignalType, D1Severity, D1Scope } from './d1_signal.types.js';

// Helper to get userId from request
function getUserId(request: FastifyRequest): string {
  const userId = request.headers['x-user-id'] as string;
  return userId || 'anonymous';
}

export async function d1SignalRoutes(app: FastifyInstance): Promise<void> {
  
  // ==================== LIST & FILTERS ====================
  
  /**
   * GET /api/d1-signals
   * List signals with filters
   */
  app.get('/', async (request: FastifyRequest<{
    Querystring: {
      window?: string;
      status?: string;
      type?: string;
      scope?: string;
      severity?: string;
      confidence?: string;
      q?: string;
      actorId?: string;
      entityId?: string;
      sort?: string;
      dir?: string;
      page?: string;
      limit?: string;
    }
  }>, reply: FastifyReply) => {
    const { 
      window, status, type, scope, severity, confidence, 
      q, actorId, entityId, sort, dir, page, limit 
    } = request.query;
    
    const query: D1SignalQuery = {
      window: (window as D1Window) || '7d',
      status: status ? (status.includes(',') ? status.split(',') as D1Status[] : status as D1Status) : undefined,
      type: type ? (type.includes(',') ? type.split(',') as D1SignalType[] : type as D1SignalType) : undefined,
      scope: scope ? (scope.includes(',') ? scope.split(',') as D1Scope[] : scope as D1Scope) : undefined,
      severity: severity ? (severity.includes(',') ? severity.split(',') as D1Severity[] : severity as D1Severity) : undefined,
      confidence: confidence ? confidence.split(',') as ('low' | 'medium' | 'high')[] : undefined,
      q,
      actorId,
      entityId,
      sort: sort as 'time' | 'severity' | 'confidence',
      dir: dir as 'asc' | 'desc',
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : 12
    };
    
    const result = await service.getSignals(query);
    return { ok: true, ...result };
  });
  
  /**
   * GET /api/d1-signals/stats/summary
   * Get signal stats for counters
   */
  app.get('/stats/summary', async (request: FastifyRequest<{
    Querystring: { window?: string }
  }>) => {
    const window = (request.query.window as D1Window) || '7d';
    const stats = await service.getSignalStats(window);
    return { ok: true, data: stats };
  });
  
  /**
   * GET /api/d1-signals/facets
   * Get available filter options
   */
  app.get('/facets', async (request: FastifyRequest<{
    Querystring: { window?: string }
  }>) => {
    const window = (request.query.window as D1Window) || '7d';
    const facets = await service.getSignalFacets(window);
    return { ok: true, data: facets };
  });
  
  // ==================== SINGLE SIGNAL ====================
  
  /**
   * GET /api/d1-signals/:id
   * Get signal details
   */
  app.get('/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const signal = await service.getSignalById(request.params.id);
    if (!signal) {
      return reply.status(404).send({ ok: false, error: 'Signal not found' });
    }
    return { ok: true, data: signal };
  });
  
  /**
   * GET /api/d1-signals/:id/history
   * Get signal lifecycle history
   */
  app.get('/:id/history', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const history = await service.getSignalHistory(request.params.id);
    if (!history) {
      return reply.status(404).send({ ok: false, error: 'Signal not found' });
    }
    return { ok: true, data: history };
  });
  
  /**
   * GET /api/d1-signals/:id/graph-context
   * Get graph context for signal highlighting
   */
  app.get('/:id/graph-context', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const context = await service.getSignalGraphContext(request.params.id);
    if (!context) {
      return reply.status(404).send({ ok: false, error: 'Signal not found' });
    }
    return { ok: true, data: context };
  });
  
  // ==================== MUTATIONS ====================
  
  /**
   * POST /api/d1-signals/:id/archive
   * Archive a signal
   */
  app.post('/:id/archive', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const signal = await service.archiveSignal(request.params.id);
    if (!signal) {
      return reply.status(404).send({ ok: false, error: 'Signal not found' });
    }
    return { ok: true, data: signal };
  });
  
  // ==================== DEV / SEED ====================
  
  /**
   * POST /api/d1-signals/seed
   * Seed sample signals (dev only)
   */
  app.post('/seed', async (request: FastifyRequest<{
    Body?: { count?: number; window?: string }
  }>) => {
    const count = request.body?.count || 15;
    const window = (request.body?.window as D1Window) || '7d';
    const result = await service.seedSignals(count, window);
    return { ok: true, data: result, message: `Seeded ${result.created} signals` };
  });
  
  /**
   * DELETE /api/d1-signals/clear
   * Clear all signals (dev only)
   */
  app.delete('/clear', async () => {
    const result = await service.clearSignals();
    return { ok: true, data: result, message: `Deleted ${result.deleted} signals` };
  });
  
  // ==================== ENGINE ====================
  
  /**
   * POST /api/d1-signals/run
   * Trigger signal engine run (ETAP 6.4: reads from snapshot)
   */
  app.post('/run', async (request: FastifyRequest<{
    Body?: { window?: string; snapshotId?: string }
  }>) => {
    const window = (request.body?.window as D1Window) || '7d';
    const snapshotId = request.body?.snapshotId;
    
    // Use Engine v2 (snapshot-based)
    const result = await runSignalEngineV2(window, snapshotId);
    
    return { 
      ok: result.status === 'completed', 
      data: {
        runId: result.runId,
        window: result.window,
        snapshotId: result.snapshotId,
        created: result.created,
        updated: result.updated,
        resolved: result.resolved,
        skippedDuplicates: result.skippedDuplicates,
        status: result.status,
      }, 
      message: result.status === 'completed' 
        ? `Engine run completed: ${result.created} created, ${result.updated} updated, ${result.resolved} resolved`
        : `Engine run failed: ${result.errors.join(', ')}`
    };
  });
  
  /**
   * GET /api/d1-signals/run/last
   * Get last engine run info
   */
  app.get('/run/last', async (request: FastifyRequest<{
    Querystring: { window?: string }
  }>) => {
    const window = (request.query.window as D1Window) || '7d';
    const run = await getLastRunV2(window);
    return { ok: true, data: run };
  });
  
  // ==================== TELEGRAM ====================
  
  /**
   * POST /api/d1-signals/telegram/test
   * Send test signal to Telegram (dev only)
   */
  app.post('/telegram/test', async () => {
    const result = await telegram.sendTestSignal();
    return { 
      ok: result.sent, 
      data: result,
      message: result.sent 
        ? 'Test signal sent to Telegram'
        : `Test failed: ${result.reason || result.error}`
    };
  });
  
  /**
   * POST /api/d1-signals/telegram/dispatch
   * Manually dispatch HIGH severity signals to Telegram
   */
  app.post('/telegram/dispatch', async () => {
    // Get all HIGH severity signals that haven't been sent
    const signals = await service.getSignals({
      severity: ['high'],
      status: ['new', 'active'],
      limit: 50,
    });
    
    const result = await telegram.dispatchSignalsToTelegram(signals.items);
    return { 
      ok: true, 
      data: result,
      message: `Dispatched: ${result.sent} sent, ${result.skipped} skipped, ${result.failed} failed`
    };
  });
  
  // ==================== TELEGRAM LINKING (ETAP 5.1) ====================
  
  /**
   * GET /api/d1-signals/telegram/status
   * Get user's Telegram link status
   */
  app.get('/telegram/status', async (request) => {
    const userId = getUserId(request);
    const link = await telegramLink.getTelegramLink(userId);
    
    return {
      ok: true,
      data: {
        linked: !!link,
        linkedAt: link?.linkedAt,
        chatId: link?.telegramChatId?.slice(0, 4) + '****', // Mask for privacy
      }
    };
  });
  
  /**
   * POST /api/d1-signals/telegram/link
   * Generate linking code for user
   */
  app.post('/telegram/link', async (request) => {
    const userId = getUserId(request);
    const { code, expiresIn } = telegramLink.createLinkCode(userId);
    
    return {
      ok: true,
      data: {
        linkCode: code,
        expiresIn,
        botUsername: 'FOMO_a_bot',
        instructions: `Send to @FOMO_a_bot: /link ${code}`,
      }
    };
  });
  
  /**
   * POST /api/d1-signals/telegram/unlink
   * Unlink user's Telegram
   */
  app.post('/telegram/unlink', async (request) => {
    const userId = getUserId(request);
    const unlinked = await telegramLink.unlinkTelegram(userId);
    
    return {
      ok: true,
      unlinked,
    };
  });
  
  /**
   * POST /api/d1-signals/telegram/test-signal
   * Send test alert to user's linked Telegram
   */
  app.post('/telegram/test-signal', async (request) => {
    const userId = getUserId(request);
    const result = await telegramLink.sendTestSignal(userId);
    
    return {
      ok: result.ok,
      error: result.error,
      message: result.ok 
        ? 'Test alert sent to your Telegram'
        : `Failed: ${result.error}`
    };
  });
  
  app.log.info('[D1 Signals] Routes registered');
}
