/**
 * ML v2.2: Admin Auto-Retrain Routes
 * 
 * API для управления auto-retrain политиками:
 * - GET /api/admin/ml/auto-retrain/policies - список всех политик
 * - GET /api/admin/ml/auto-retrain/policies/:task/:network - конкретная политика
 * - POST /api/admin/ml/auto-retrain/policies/:task/:network - обновить политику
 * - POST /api/admin/ml/auto-retrain/run/:task/:network - ручной запуск
 * - POST /api/admin/ml/auto-retrain/dry-run/:task/:network - проверка без запуска
 * - GET /api/admin/ml/auto-retrain/decisions - история решений
 * - GET /api/admin/ml/auto-retrain/status - статус scheduler
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../../admin/admin.middleware.js';
import { AutoRetrainPolicyService } from './auto_retrain_policy.service.js';
import { MlRetrainPolicyModel } from './ml_retrain_policy.model.js';
import { MlAutoRetrainDecisionModel } from './ml_auto_retrain_decision.model.js';
import { 
  startAutoRetrainScheduler, 
  stopAutoRetrainScheduler, 
  isSchedulerRunning,
  triggerEvaluation 
} from './auto_retrain_scheduler.service.js';

interface TaskNetworkParams {
  task: 'market' | 'actor';
  network: string;
}

interface DecisionsQuery {
  task?: 'market' | 'actor';
  network?: string;
  limit?: number;
}

export async function adminMlAutoRetrainRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /auto-retrain/policies
   * List all auto-retrain policies
   */
  app.get(
    '/auto-retrain/policies',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const policies = await MlRetrainPolicyModel.find().lean();
      
      const summary = {
        total: policies.length,
        enabled: policies.filter(p => p.enabled).length,
        disabled: policies.filter(p => !p.enabled).length,
      };

      return reply.send({
        ok: true,
        summary,
        policies,
      });
    }
  );

  /**
   * GET /auto-retrain/policies/:task/:network
   * Get specific policy
   */
  app.get<{ Params: TaskNetworkParams }>(
    '/auto-retrain/policies/:task/:network',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Params: TaskNetworkParams }>, reply: FastifyReply) => {
      const { task, network } = request.params;
      const policy = await AutoRetrainPolicyService.getPolicy(task, network);
      
      if (!policy) {
        return reply.code(404).send({
          ok: false,
          error: 'POLICY_NOT_FOUND',
        });
      }

      return reply.send({ ok: true, policy });
    }
  );

  /**
   * POST /auto-retrain/policies/:task/:network
   * Update policy
   */
  app.post<{ Params: TaskNetworkParams; Body: any }>(
    '/auto-retrain/policies/:task/:network',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: TaskNetworkParams; Body: any }>, reply: FastifyReply) => {
      const { task, network } = request.params;
      const updates = request.body;
      
      // Extract admin info from token
      const adminUser = (request as any).user;
      const updatedBy = adminUser ? { id: adminUser.id, email: adminUser.email } : undefined;

      const policy = await AutoRetrainPolicyService.updatePolicy(
        task, 
        network, 
        updates,
        updatedBy
      );

      console.log(`[v2.2] Policy updated: ${task}/${network} enabled=${policy?.enabled}`);

      return reply.send({ ok: true, policy });
    }
  );

  /**
   * POST /auto-retrain/run/:task/:network
   * Manually trigger evaluation and enqueue
   */
  app.post<{ Params: TaskNetworkParams }>(
    '/auto-retrain/run/:task/:network',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: TaskNetworkParams }>, reply: FastifyReply) => {
      const { task, network } = request.params;
      
      console.log(`[v2.2] Manual trigger: ${task}/${network}`);
      
      const result = await triggerEvaluation(task, network);
      return reply.send(result);
    }
  );

  /**
   * POST /auto-retrain/dry-run/:task/:network
   * Check what would happen without actually enqueuing
   */
  app.post<{ Params: TaskNetworkParams }>(
    '/auto-retrain/dry-run/:task/:network',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Params: TaskNetworkParams }>, reply: FastifyReply) => {
      const { task, network } = request.params;
      const result = await AutoRetrainPolicyService.dryRun(task, network);
      return reply.send({ ok: true, ...result });
    }
  );

  /**
   * GET /auto-retrain/decisions
   * Get decision history
   */
  app.get<{ Querystring: DecisionsQuery }>(
    '/auto-retrain/decisions',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: DecisionsQuery }>, reply: FastifyReply) => {
      const { task, network, limit = 50 } = request.query;
      
      const filter: any = {};
      if (task) filter.task = task;
      if (network) filter.network = network;

      const decisions = await MlAutoRetrainDecisionModel
        .find(filter)
        .sort({ ts: -1 })
        .limit(Math.min(limit, 200))
        .lean();

      const summary = {
        total: decisions.length,
        enqueued: decisions.filter(d => d.decision === 'ENQUEUED').length,
        skipped: decisions.filter(d => d.decision === 'SKIPPED').length,
      };

      return reply.send({ ok: true, summary, decisions });
    }
  );

  /**
   * GET /auto-retrain/status
   * Get scheduler status
   */
  app.get(
    '/auto-retrain/status',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const running = isSchedulerRunning();
      
      // Count enabled policies
      const enabledCount = await MlRetrainPolicyModel.countDocuments({ enabled: true });
      
      // Get recent decisions stats
      const hourAgo = Math.floor(Date.now() / 1000) - 3600;
      const recentDecisions = await MlAutoRetrainDecisionModel.countDocuments({ ts: { $gte: hourAgo } });
      const recentEnqueued = await MlAutoRetrainDecisionModel.countDocuments({ 
        ts: { $gte: hourAgo }, 
        decision: 'ENQUEUED' 
      });

      return reply.send({
        ok: true,
        scheduler: {
          running,
          intervalMs: 60000,
        },
        policies: {
          enabled: enabledCount,
        },
        lastHour: {
          decisions: recentDecisions,
          enqueued: recentEnqueued,
        },
      });
    }
  );

  /**
   * POST /auto-retrain/scheduler/start
   * Start the scheduler
   */
  app.post(
    '/auto-retrain/scheduler/start',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      startAutoRetrainScheduler();
      return reply.send({ ok: true, running: true });
    }
  );

  /**
   * POST /auto-retrain/scheduler/stop
   * Stop the scheduler
   */
  app.post(
    '/auto-retrain/scheduler/stop',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      stopAutoRetrainScheduler();
      return reply.send({ ok: true, running: false });
    }
  );

  app.log.info('[v2.2] Admin ML Auto-Retrain routes registered');
}
