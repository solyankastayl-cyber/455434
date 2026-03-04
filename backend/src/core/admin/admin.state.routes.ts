/**
 * Admin State API - STEP 0.5
 * 
 * Быстрые endpoints для текущего состояния.
 * Никаких агрегаций, только флаги и статусы.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from './admin.middleware.js';
import { getSettings } from './admin.settings.service.js';
import { RetrainPolicyModel, RetrainExecutionModel } from '../ml/validation/retrain_policy.model.js';

// ============================================
// STATE: SYSTEM
// ============================================
async function getSystemState() {
  const settings = await getSettings('system');
  
  return {
    decisionMode: settings?.data?.decisionMode || 'RULES_ONLY',
    killSwitch: settings?.data?.killSwitch?.armed || false,
    globalPause: settings?.data?.globalPause || false,
    timestamp: Date.now(),
  };
}

// ============================================
// STATE: ML
// ============================================
async function getMLState() {
  const settings = await getSettings('ml');
  
  // Check Python service (simple health check)
  let pythonHealth = 'UNKNOWN';
  try {
    const response = await fetch('http://localhost:8002/health', { 
      signal: AbortSignal.timeout(2000) 
    });
    pythonHealth = response.ok ? 'OK' : 'ERROR';
  } catch {
    pythonHealth = 'OFFLINE';
  }
  
  return {
    enabled: settings?.data?.mlEnabled ?? false,
    pythonHealth,
    marketModelEnabled: settings?.data?.marketModelEnabled ?? false,
    actorModelEnabled: settings?.data?.actorModelEnabled ?? false,
    circuitBreakerState: 'CLOSED',
    timestamp: Date.now(),
  };
}

// ============================================
// STATE: PROVIDERS
// ============================================
async function getProvidersState() {
  const { getProviderPool } = await import('../providers/provider_pool.service.js');
  const pool = getProviderPool();
  const status = pool.getStatus();
  
  return {
    total: status.providers?.length || 0,
    healthy: status.providers?.filter((p: any) => p.healthy).length || 0,
    providers: (status.providers || []).map((p: any) => ({
      id: p.id,
      healthy: p.healthy,
      cooldownUntil: p.cooldownUntil,
    })),
    timestamp: Date.now(),
  };
}

// ============================================
// STATE: RETRAIN
// ============================================
async function getRetrainState() {
  const [policies, runningJobs] = await Promise.all([
    RetrainPolicyModel.find({ enabled: true }).select('policyId network').lean(),
    RetrainExecutionModel.find({ status: { $in: ['PENDING', 'IN_PROGRESS'] } }).lean(),
  ]);
  
  const lastExecution = await RetrainExecutionModel.findOne({})
    .sort({ createdAt: -1 })
    .select('status createdAt policyId')
    .lean();
  
  return {
    activePolicies: policies.length,
    runningJobs: runningJobs.length,
    status: runningJobs.length > 0 ? 'RUNNING' : 'IDLE',
    lastExecution: lastExecution ? {
      status: lastExecution.status,
      timestamp: lastExecution.createdAt,
      policyId: lastExecution.policyId,
    } : null,
    timestamp: Date.now(),
  };
}

// ============================================
// ROUTES
// ============================================
export async function adminStateRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /admin/state/system
   * System state (decision mode, kill switch)
   */
  app.get('/state/system', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = await getSystemState();
      return reply.send({ ok: true, data: state });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/state/ml
   * ML state (enabled, python health, circuit breaker)
   */
  app.get('/state/ml', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = await getMLState();
      return reply.send({ ok: true, data: state });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/state/providers
   * Providers state (healthy count, cooldowns)
   */
  app.get('/state/providers', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = await getProvidersState();
      return reply.send({ ok: true, data: state });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/state/retrain
   * Retrain state (running jobs, last execution)
   */
  app.get('/state/retrain', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const state = await getRetrainState();
      return reply.send({ ok: true, data: state });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/state/all
   * Combined state (for initial load)
   */
  app.get('/state/all', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [system, ml, providers, retrain] = await Promise.all([
        getSystemState(),
        getMLState(),
        getProvidersState(),
        getRetrainState(),
      ]);
      
      return reply.send({
        ok: true,
        data: { system, ml, providers, retrain },
        timestamp: Date.now(),
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  console.log('[Admin] State API routes registered (STEP 0.5)');
}

export default adminStateRoutes;
