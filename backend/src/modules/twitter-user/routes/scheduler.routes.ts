/**
 * Scheduler API Routes
 */

import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth/require-user.hook.js';
import { TwitterSchedulerService } from '../services/scheduler.service.js';
import { getPlannerWorker } from '../workers/planner.worker.js';

export async function registerSchedulerRoutes(app: FastifyInstance) {
  const scheduler = new TwitterSchedulerService();

  /**
   * POST /api/v4/twitter/schedule/preview
   * Preview what would be planned
   */
  app.post('/api/v4/twitter/schedule/preview', async (req, reply) => {
    try {
      const u = requireUser(req);
      const batch = await scheduler.plan(u.id);
      
      return reply.send({
        ok: true,
        data: {
          tasksPlanned: batch.tasks.length,
          postsPlanned: batch.totalPlannedPosts,
          skipped: batch.skipped,
          tasks: batch.tasks.map(t => ({
            kind: t.kind,
            query: t.query,
            estimatedPosts: t.estimatedPosts,
          })),
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/schedule/commit
   * Commit planned tasks to queue
   */
  app.post('/api/v4/twitter/schedule/commit', async (req, reply) => {
    try {
      const u = requireUser(req);
      const result = await scheduler.planAndCommit(u.id);
      
      return reply.send({
        ok: true,
        data: {
          committed: result.committed,
          totalPosts: result.batch.totalPlannedPosts,
          taskIds: result.taskIds,
          skipped: result.batch.skipped,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/v4/twitter/planner/status
   * Get planner worker status
   */
  app.get('/api/v4/twitter/planner/status', async (req, reply) => {
    try {
      const worker = getPlannerWorker();
      const status = worker.getStatus();
      
      return reply.send({
        ok: true,
        data: status,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/planner/run-once
   * Trigger one planning cycle (admin/dev)
   */
  app.post('/api/v4/twitter/planner/run-once', async (req, reply) => {
    try {
      const worker = getPlannerWorker();
      const result = await worker.runOnce();
      
      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/planner/enable
   * Enable the planner worker
   */
  app.post('/api/v4/twitter/planner/enable', async (req, reply) => {
    try {
      const worker = getPlannerWorker();
      worker.start();
      
      return reply.send({
        ok: true,
        data: worker.getStatus(),
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/v4/twitter/planner/disable
   * Disable the planner worker
   */
  app.post('/api/v4/twitter/planner/disable', async (req, reply) => {
    try {
      const worker = getPlannerWorker();
      worker.stop();
      
      return reply.send({
        ok: true,
        data: worker.getStatus(),
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
