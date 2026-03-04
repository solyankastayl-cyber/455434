/**
 * ETAP 6.3 — Snapshot Routes
 * 
 * API endpoints for snapshot management.
 * 
 * Endpoints:
 * - POST /api/signal-snapshots/build - Build snapshot for a window
 * - GET /api/signal-snapshots/latest - Get latest snapshot
 * - GET /api/signal-snapshots/:id - Get snapshot by ID
 * - GET /api/signal-snapshots/list - List snapshots
 * - GET /api/signal-snapshots/stats - Get snapshot stats
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  buildSnapshot,
  getLatestSnapshot,
  getSnapshotById,
  listSnapshots,
  getSnapshotStats,
  cleanupOldSnapshots,
} from './snapshot.builder.js';
import type { SnapshotWindow } from './snapshot.types.js';

// ==================== SCHEMAS ====================

const WindowQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
});

const ListQuerySchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
  limit: z.coerce.number().min(1).max(50).default(10),
});

const BuildSnapshotSchema = z.object({
  window: z.enum(['24h', '7d', '30d']).default('24h'),
});

// ==================== ROUTES ====================

export async function registerSnapshotRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/signal-snapshots/build
   * Build snapshot for a window
   */
  app.post('/api/signal-snapshots/build', async (
    request: FastifyRequest<{ Body: z.infer<typeof BuildSnapshotSchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const body = BuildSnapshotSchema.parse(request.body || {});
      const result = await buildSnapshot(body.window as SnapshotWindow);

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] Build failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/signal-snapshots/latest
   * Get latest snapshot for a window
   */
  app.get('/api/signal-snapshots/latest', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof WindowQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = WindowQuerySchema.parse(request.query || {});
      const snapshot = await getLatestSnapshot(query.window as SnapshotWindow);

      if (!snapshot) {
        return reply.status(404).send({
          ok: false,
          error: `No snapshot found for window: ${query.window}`,
        });
      }

      return reply.send({
        ok: true,
        data: snapshot,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] Latest failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/signal-snapshots/:id
   * Get snapshot by ID
   */
  app.get('/api/signal-snapshots/:id', async (
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { id } = request.params;
      const snapshot = await getSnapshotById(id);

      if (!snapshot) {
        return reply.status(404).send({
          ok: false,
          error: `Snapshot not found: ${id}`,
        });
      }

      return reply.send({
        ok: true,
        data: snapshot,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] Get by ID failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/signal-snapshots/list
   * List snapshots for a window
   */
  app.get('/api/signal-snapshots/list', async (
    request: FastifyRequest<{ Querystring: z.infer<typeof ListQuerySchema> }>,
    reply: FastifyReply
  ) => {
    try {
      const query = ListQuerySchema.parse(request.query || {});
      const snapshots = await listSnapshots(query.window as SnapshotWindow, query.limit);

      return reply.send({
        ok: true,
        data: {
          window: query.window,
          count: snapshots.length,
          snapshots,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] List failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * GET /api/signal-snapshots/stats
   * Get snapshot statistics
   */
  app.get('/api/signal-snapshots/stats', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const stats = await getSnapshotStats();

      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] Stats failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  /**
   * POST /api/signal-snapshots/cleanup
   * Cleanup old snapshots
   */
  app.post('/api/signal-snapshots/cleanup', async (
    request: FastifyRequest<{ Body: { keepCount?: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const keepCount = (request.body as { keepCount?: number })?.keepCount || 10;
      const deleted = await cleanupOldSnapshots(keepCount);

      return reply.send({
        ok: true,
        data: {
          deleted,
          keptPerWindow: keepCount,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Snapshot Routes] Cleanup failed:', message);
      return reply.status(500).send({
        ok: false,
        error: message,
      });
    }
  });

  console.log('[Snapshot] Routes registered: /api/signal-snapshots/*');
}
