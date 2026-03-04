// P1/P2: Worker Routes
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { sessionHealthWorker } from '../../../workers/session-health.worker.js';
import { twitterParserExecutor } from '../execution/executor.service.js';
import { mongoTaskWorker } from '../execution/worker/mongo.worker.js';
import { mongoTaskQueue } from '../execution/queue/mongo.queue.js';

export async function registerWorkerRoutes(app: FastifyInstance): Promise<void> {
  // P1: Get session health worker status
  app.get('/worker/health-status', async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ ok: true, data: sessionHealthWorker.getStatus() });
  });

  // P1: Trigger manual health check
  app.post('/worker/health-run', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await sessionHealthWorker.runRiskCheck();
      return reply.send({ ok: true, message: 'Health check triggered' });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });

  // ========== P2: Task Queue Worker ==========

  // Get task worker status
  app.get('/worker/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const status = await twitterParserExecutor.getWorkerStatus();
    return reply.send({ ok: true, data: status });
  });

  // Start task worker
  app.post('/worker/start', async (req: FastifyRequest, reply: FastifyReply) => {
    twitterParserExecutor.startWorker();
    return reply.send({ ok: true, message: 'Task worker started' });
  });

  // Stop task worker
  app.post('/worker/stop', async (req: FastifyRequest, reply: FastifyReply) => {
    await twitterParserExecutor.stopWorker();
    return reply.send({ ok: true, message: 'Task worker stopped' });
  });

  // Get queue statistics
  app.get('/queue/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const stats = await twitterParserExecutor.getQueueStats();
    return reply.send({ ok: true, data: stats });
  });

  // Get recent tasks
  app.get('/queue/tasks', async (req: FastifyRequest, reply: FastifyReply) => {
    const limit = Number((req.query as any).limit) || 50;
    const tasks = await twitterParserExecutor.getRecentTasks(limit);
    return reply.send({ ok: true, data: tasks });
  });

  // Get specific task
  app.get<{ Params: { taskId: string } }>(
    '/queue/tasks/:taskId',
    async (req, reply) => {
      const { found, task, result } = await twitterParserExecutor.getTaskStatus(req.params.taskId);
      if (!found) {
        return reply.status(404).send({ ok: false, error: 'Task not found' });
      }
      return reply.send({ ok: true, data: { task, result } });
    }
  );

  // Recover stale tasks manually
  app.post('/queue/recover', async (req: FastifyRequest, reply: FastifyReply) => {
    const recovered = await mongoTaskQueue.recoverStaleTasks();
    return reply.send({ ok: true, recovered });
  });

  // Cleanup old tasks manually
  app.post('/queue/cleanup', async (req: FastifyRequest, reply: FastifyReply) => {
    const deleted = await mongoTaskQueue.cleanup();
    return reply.send({ ok: true, deleted });
  });

  // Legacy alias for backward compat
  app.get('/worker/run-now', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await sessionHealthWorker.runRiskCheck();
      return reply.send({ ok: true, message: 'Health check triggered' });
    } catch (error: any) {
      return reply.status(500).send({ ok: false, error: error.message });
    }
  });
}
