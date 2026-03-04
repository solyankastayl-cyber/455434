/**
 * Admin ML Retrain Routes
 * 
 * BATCH 1: API для управления очередью retrain.
 * 
 * Endpoints:
 * - POST /api/admin/ml/retrain/start - Add job to queue
 * - GET /api/admin/ml/retrain/queue - Get queue status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MlRetrainQueueModel, RetrainReason } from './ml_retrain_queue.model.js';
import { requireAdminAuth } from '../admin/admin.middleware.js';
import { RetrainExecutorService } from './retrain_executor.service.js';

interface StartRetrainBody {
  modelType: 'market' | 'actor';
  network: string;
  reason?: RetrainReason;
}

export async function adminMlRetrainRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * POST /ml/retrain/start
   * Add a new retrain job to queue
   */
  app.post<{ Body: StartRetrainBody }>(
    '/ml/retrain/start',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: StartRetrainBody }>, reply: FastifyReply) => {
      const { modelType, network, reason = 'MANUAL' } = request.body;

      if (!modelType || !network) {
        return reply.code(400).send({
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'modelType and network are required'
        });
      }

      if (!['market', 'actor'].includes(modelType)) {
        return reply.code(400).send({
          ok: false,
          error: 'VALIDATION_ERROR',
          message: 'modelType must be "market" or "actor"'
        });
      }

      // Check if there's already a pending/running job for same model+network
      const existing = await MlRetrainQueueModel.findOne({
        modelType,
        network,
        status: { $in: ['PENDING', 'RUNNING'] }
      });

      if (existing) {
        return reply.code(409).send({
          ok: false,
          error: 'JOB_EXISTS',
          message: `Retrain job already ${existing.status} for ${modelType}/${network}`,
          jobId: existing._id
        });
      }

      const job = await MlRetrainQueueModel.create({
        modelType,
        network,
        reason
      });

      console.log(`[Admin] Retrain job created: ${modelType}/${network} (${reason})`);

      return reply.send({
        ok: true,
        jobId: job._id,
        status: job.status
      });
    }
  );

  /**
   * GET /ml/retrain/queue
   * Get retrain queue status
   */
  app.get(
    '/ml/retrain/queue',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const jobs = await MlRetrainQueueModel
        .find()
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const pending = jobs.filter(j => j.status === 'PENDING').length;
      const running = jobs.filter(j => j.status === 'RUNNING').length;

      return reply.send({
        ok: true,
        summary: {
          pending,
          running,
          total: jobs.length,
          executorLocked: RetrainExecutorService.isRunning()
        },
        jobs
      });
    }
  );

  /**
   * POST /ml/retrain/force-run
   * Force immediate execution of next pending job
   */
  app.post(
    '/ml/retrain/force-run',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      if (RetrainExecutorService.isRunning()) {
        return reply.code(409).send({
          ok: false,
          error: 'EXECUTOR_BUSY',
          message: 'Retrain executor is already running'
        });
      }

      // Don't await - run async
      RetrainExecutorService.runNext().catch(err => {
        console.error('[Admin] Force run error:', err);
      });

      return reply.send({
        ok: true,
        message: 'Retrain execution triggered'
      });
    }
  );

  app.log.info('[BATCH 1] Admin ML Retrain routes registered');
}
