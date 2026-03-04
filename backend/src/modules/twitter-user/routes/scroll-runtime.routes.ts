/**
 * Scroll Runtime API Routes
 * 
 * Used by parser to communicate with scroll engine
 */

import type { FastifyInstance } from 'fastify';
import { ScrollEngine, selectInitialProfile, type ScrollEngineConfig } from '../scroll/scroll-engine.js';
import { ScrollProfile } from '../scroll/scroll-profiles.js';
import type { ScrollTelemetry } from '../scroll/scroll-risk.js';

// Active engines (in-memory, keyed by taskId)
const activeEngines = new Map<string, ScrollEngine>();

export async function registerScrollRuntimeRoutes(app: FastifyInstance) {
  
  /**
   * POST /api/v4/runtime/scroll/start
   * Initialize scroll engine for a task
   */
  app.post('/api/v4/runtime/scroll/start', async (req, reply) => {
    try {
      const body = req.body as {
        taskId: string;
        targetId: string;
        ownerUserId: string;
        accountId: string;
        plannedPosts: number;
        profile?: ScrollProfile;
      };

      if (!body.taskId || !body.ownerUserId) {
        return reply.code(400).send({ ok: false, error: 'taskId and ownerUserId required' });
      }

      const config: ScrollEngineConfig = {
        targetId: body.targetId || 'unknown',
        ownerUserId: body.ownerUserId,
        accountId: body.accountId || 'default',
        plannedPosts: body.plannedPosts || 50,
        initialProfile: body.profile || selectInitialProfile(),
      };

      const engine = new ScrollEngine(config);
      activeEngines.set(body.taskId, engine);

      const hints = engine.getInitialHints();

      return reply.send({
        ok: true,
        data: {
          taskId: body.taskId,
          hints,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/runtime/scroll/telemetry
   * Report telemetry and get next hints
   */
  app.post('/api/v4/runtime/scroll/telemetry', async (req, reply) => {
    try {
      const body = req.body as {
        taskId: string;
        telemetry: ScrollTelemetry;
      };

      const engine = activeEngines.get(body.taskId);
      if (!engine) {
        return reply.code(404).send({ ok: false, error: 'Engine not found' });
      }

      const hints = engine.processTelemetry({
        ...body.telemetry,
        timestamp: new Date(),
      });

      return reply.send({
        ok: true,
        data: {
          hints,
          state: engine.getState(),
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/runtime/scroll/finish
   * Finish and cleanup engine
   */
  app.post('/api/v4/runtime/scroll/finish', async (req, reply) => {
    try {
      const body = req.body as { taskId: string };

      const engine = activeEngines.get(body.taskId);
      if (!engine) {
        return reply.code(404).send({ ok: false, error: 'Engine not found' });
      }

      const summary = engine.getSummary();
      activeEngines.delete(body.taskId);

      // TODO: Update account scroll memory
      // TODO: Update session health if aborted

      return reply.send({
        ok: true,
        data: summary,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/runtime/scroll/status/:taskId
   * Get current engine status
   */
  app.get('/api/v4/runtime/scroll/status/:taskId', async (req, reply) => {
    try {
      const { taskId } = req.params as { taskId: string };

      const engine = activeEngines.get(taskId);
      if (!engine) {
        return reply.code(404).send({ ok: false, error: 'Engine not found' });
      }

      return reply.send({
        ok: true,
        data: engine.getState(),
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
