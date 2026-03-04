/**
 * Bootstrap Routes (P2.1)
 * 
 * API endpoints for bootstrap task management.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as bootstrapService from './bootstrap.service.js';
import * as bootstrapRepository from './bootstrap.repository.js';
import * as bootstrapWorker from './bootstrap.worker.js';

export async function bootstrapRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/bootstrap/stats
   * Get queue statistics
   */
  app.get('/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const stats = await bootstrapService.getQueueStats();
      const workerStatus = bootstrapWorker.getStatus();
      return reply.send({ 
        ok: true, 
        data: {
          queue: stats,
          worker: workerStatus,
        },
      });
    } catch (error) {
      return reply.status(500).send({ 
        ok: false, 
        error: 'Failed to get bootstrap stats',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/bootstrap/status/:subjectType/:chain/:identifier
   * Get task status for a specific subject
   */
  app.get('/status/:subjectType/:chain/:identifier', async (
    request: FastifyRequest<{
      Params: { subjectType: string; chain: string; identifier: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { subjectType, chain, identifier } = request.params;
      
      const status = await bootstrapService.getStatus(
        subjectType as any,
        chain,
        identifier
      );
      
      return reply.send({ ok: true, data: status });
    } catch (error) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get task status',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/bootstrap/status?dedupKey=...
   * Get task status by dedupKey (for polling)
   */
  app.get('/status', async (
    request: FastifyRequest<{
      Querystring: { dedupKey?: string };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { dedupKey } = request.query;
      
      if (!dedupKey) {
        return reply.status(400).send({
          ok: false,
          error: 'dedupKey query parameter is required',
        });
      }
      
      const status = await bootstrapRepository.getTaskStatusByDedupKey(dedupKey);
      
      return reply.send({ ok: true, data: status });
    } catch (error) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get task status',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/bootstrap/enqueue
   * Manually enqueue a bootstrap task
   */
  app.post('/enqueue', async (
    request: FastifyRequest<{
      Body: {
        subjectType: string;
        chain?: string;
        address?: string;
        subjectId?: string;
        tokenAddress?: string;
        priority?: number;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { subjectType, chain, address, subjectId, tokenAddress, priority } = request.body;
      
      if (!subjectType) {
        return reply.status(400).send({
          ok: false,
          error: 'subjectType is required',
        });
      }
      
      if (!address && !subjectId && !tokenAddress) {
        return reply.status(400).send({
          ok: false,
          error: 'At least one of address, subjectId, or tokenAddress is required',
        });
      }
      
      const result = await bootstrapService.enqueue({
        subjectType: subjectType as any,
        chain: (chain as any) || 'ethereum',
        address,
        subjectId,
        tokenAddress,
        priority,
      });
      
      const eta = bootstrapService.estimateETA(subjectType as any);
      
      return reply.send({
        ok: true,
        data: {
          ...result,
          eta,
        },
      });
    } catch (error) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to enqueue bootstrap task',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/bootstrap/worker/start
   * Start the bootstrap worker
   */
  app.post('/worker/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      bootstrapWorker.start();
      return reply.send({
        ok: true,
        data: {
          message: 'Worker started',
          status: bootstrapWorker.getStatus(),
        },
      });
    } catch (error) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to start worker',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/bootstrap/worker/stop
   * Stop the bootstrap worker
   */
  app.post('/worker/stop', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      bootstrapWorker.stop();
      return reply.send({
        ok: true,
        data: {
          message: 'Worker stopped',
          status: bootstrapWorker.getStatus(),
        },
      });
    } catch (error) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to stop worker',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
