/**
 * Phase O: Stream API Routes
 * 
 * REST endpoints for stream diagnostics
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { Db } from 'mongodb';
import { EventBus } from '../event_bus.js';
import { TAStreamService } from '../stream_service.js';
import { getOutboxStats, cleanupDelivered, initOutboxIndexes } from '../outbox_store.js';
import { pumpOutbox } from '../jobs/outbox_pump_job.js';

export interface StreamRouteDeps {
  db: Db;
  bus: EventBus;
  streamService: TAStreamService;
  outboxEnabled: boolean;
}

export async function registerStreamRoutes(
  app: FastifyInstance,
  deps: StreamRouteDeps
): Promise<void> {
  const { db, bus, streamService, outboxEnabled } = deps;

  // Initialize indexes
  initOutboxIndexes(db).catch(console.error);

  /**
   * GET /api/ta/stream/health
   * Get stream service health
   */
  app.get('/stream/health', async () => {
    const outbox = await getOutboxStats(db);
    const busStats = bus.getStats();
    const serviceStats = streamService.getStats();

    return {
      ok: true,
      outboxEnabled,
      outboxPending: outbox.pending,
      outboxDelivered: outbox.delivered,
      busSubscribers: busStats.subscribers,
      busEventCount: busStats.eventCount,
      serviceEmitCount: serviceStats.emitCount,
    };
  });

  /**
   * GET /api/ta/stream/stats
   * Get detailed stream stats
   */
  app.get('/stream/stats', async () => {
    const outbox = await getOutboxStats(db);
    const busStats = bus.getStats();
    const serviceStats = streamService.getStats();

    return {
      ok: true,
      outbox,
      bus: busStats,
      service: serviceStats,
    };
  });

  /**
   * POST /api/ta/stream/pump
   * Manually pump outbox
   */
  app.post('/stream/pump', async () => {
    const result = await pumpOutbox({ db, bus });
    return { ok: result.ok, ...result };
  });

  /**
   * GET /api/ta/stream/replay
   * Replay recent events
   */
  app.get('/stream/replay', async (request: FastifyRequest<{
    Querystring: { limit?: string; asset?: string; type?: string }
  }>) => {
    const { limit = '100', asset, type } = request.query;

    const filter: any = {};
    if (asset) filter.asset = asset;
    if (type) filter.type = type;

    const items = await db.collection('ta_outbox_events')
      .find(filter)
      .sort({ ts: -1 })
      .limit(parseInt(limit, 10))
      .project({ _id: 0 })
      .toArray();

    return { ok: true, count: items.length, items };
  });

  /**
   * POST /api/ta/stream/cleanup
   * Cleanup old delivered events
   */
  app.post('/stream/cleanup', async (request: FastifyRequest<{
    Body: { olderThanHours?: number }
  }>) => {
    const { olderThanHours = 24 } = request.body || {};
    const olderThanMs = olderThanHours * 60 * 60 * 1000;

    const deleted = await cleanupDelivered(db, olderThanMs);
    return { ok: true, deleted, olderThanHours };
  });

  /**
   * POST /api/ta/stream/test
   * Send a test event
   */
  app.post('/stream/test', async (request: FastifyRequest<{
    Body: { asset?: string; message?: string }
  }>) => {
    const { asset = 'TEST', message = 'Test event' } = request.body || {};

    const eventId = await streamService.emitAlert({
      asset,
      alertType: 'TEST',
      severity: 'INFO',
      message,
    });

    return { ok: true, eventId };
  });
}
