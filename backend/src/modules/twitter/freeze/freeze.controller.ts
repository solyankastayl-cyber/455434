// P3 FREEZE Validation - Controller
// API endpoints for freeze validation

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { loadRunnerService } from './load-runner.service.js';
import { freezeGateService, LoadProfile } from './freeze-gate.service.js';
import { metricsService } from './metrics.service.js';
import { liveTaskQueue } from '../execution/queue/live.queue.js';

interface RunFreezeBody {
  profile: LoadProfile;
}

export async function registerFreezeRoutes(app: FastifyInstance): Promise<void> {
  // Run freeze validation test
  app.post<{ Body: RunFreezeBody }>(
    '/freeze/run',
    async (request: FastifyRequest<{ Body: RunFreezeBody }>, reply: FastifyReply) => {
      try {
        const { profile = 'SMOKE' } = request.body || {};
        
        if (!['SMOKE', 'STRESS', 'SOAK'].includes(profile)) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid profile. Use SMOKE, STRESS, or SOAK',
          });
        }

        // Start async - don't await
        loadRunnerService.run(profile as LoadProfile).catch(err => {
          console.error('[FreezeController] Run failed:', err);
        });

        return reply.send({
          ok: true,
          message: `${profile} test started`,
          state: loadRunnerService.getState(),
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  // Get current status
  app.get(
    '/freeze/status',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const state = loadRunnerService.getState();
      return reply.send({
        ok: true,
        data: state,
      });
    }
  );

  // Get latest result
  app.get(
    '/freeze/latest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = freezeGateService.getLastResult();
      if (!result) {
        return reply.status(404).send({
          ok: false,
          error: 'No freeze validation results yet',
        });
      }
      return reply.send({
        ok: true,
        data: result,
      });
    }
  );

  // Get current metrics snapshot
  app.get(
    '/metrics/snapshot',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const queueStats = liveTaskQueue.getStats();
      const snapshot = metricsService.getSnapshot(queueStats.pending + queueStats.running);
      return reply.send({
        ok: true,
        data: {
          ...snapshot,
          queueStats,
        },
      });
    }
  );

  // Abort running test
  app.post(
    '/freeze/abort',
    async (request: FastifyRequest, reply: FastifyReply) => {
      loadRunnerService.abort();
      return reply.send({
        ok: true,
        message: 'Abort signal sent',
        state: loadRunnerService.getState(),
      });
    }
  );

  // Reset metrics
  app.post(
    '/metrics/reset',
    async (request: FastifyRequest, reply: FastifyReply) => {
      metricsService.reset();
      return reply.send({
        ok: true,
        message: 'Metrics reset',
      });
    }
  );

  // Monitor endpoint - system health overview
  app.get(
    '/monitor',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const queueStats = liveTaskQueue.getStats();
        const metricsSnapshot = metricsService.getSnapshot(queueStats.pending + queueStats.running);
        const freezeResult = freezeGateService.getLastResult();
        
        const totalTasks = metricsSnapshot.counters.tasksSucceeded + metricsSnapshot.counters.tasksFailed;
        const successRate = totalTasks > 0 
          ? (metricsSnapshot.counters.tasksSucceeded / totalTasks) * 100 
          : 100;
        
        return reply.send({
          ok: true,
          data: {
            timestamp: new Date().toISOString(),
            totalSlots: 1,
            healthySlots: 1,
            degradedSlots: 0,
            errorSlots: 0,
            totalCapacityPerHour: 200,
            usedCapacityThisHour: metricsSnapshot.counters.tasksSucceeded,
            availableCapacity: Math.max(0, 200 - metricsSnapshot.counters.tasksSucceeded),
            queueDepth: queueStats.pending,
            activeJobs: queueStats.running,
            successRate24h: Math.round(successRate * 100) / 100,
            avgLatency: metricsSnapshot.latency.runtimeP50,
            lastFreezeResult: freezeResult ? {
              status: freezeResult.status,
              profile: freezeResult.profile,
              timestamp: freezeResult.timestamp,
            } : null,
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  // Test LocalParserRuntime directly (MULTI architecture)
  app.post(
    '/test-parser',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { keyword, limit } = request.body as { keyword: string; limit?: number };
        
        if (!keyword) {
          return reply.status(400).send({
            ok: false,
            error: 'keyword is required',
          });
        }

        const { createLocalParserRuntime } = await import('../runtime/adapters/local-parser.runtime.js');
        const runtime = createLocalParserRuntime('http://localhost:5001');

        const result = await runtime.fetchTweetsByKeyword({
          keyword,
          limit: limit || 10,
        });

        return reply.send(result);
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  // Test LocalParserRuntime health
  app.get(
    '/parser-health',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { createLocalParserRuntime } = await import('../runtime/adapters/local-parser.runtime.js');
        const runtime = createLocalParserRuntime('http://localhost:5001');

        const health = await runtime.getHealth();

        return reply.send({
          ok: true,
          data: {
            runtimeHealth: health,
            parserUrl: 'http://localhost:5001',
          },
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message,
        });
      }
    }
  );
}
