/**
 * ML Governance Admin Routes
 * 
 * Human-in-the-loop approval API:
 * - GET /api/admin/ml/approvals/pending - List pending approvals
 * - GET /api/admin/ml/approvals/candidates - List all candidates
 * - GET /api/admin/ml/approvals/active/:task/:network - Get active model
 * - POST /api/admin/ml/approvals/request - Request approval
 * - POST /api/admin/ml/approvals/approve - Approve model
 * - POST /api/admin/ml/approvals/reject - Reject model
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { mlGovernanceService } from './ml_governance.service.js';
import type { MlTask, ApprovalActor } from './ml_governance.types.js';

interface TaskNetworkParams {
  task: MlTask;
  network: string;
}

interface ApprovalBody {
  modelId: string;
  note?: string;
}

interface QueryFilters {
  task?: MlTask;
  network?: string;
}

/**
 * Get actor from request (admin user)
 */
function getActor(request: FastifyRequest): ApprovalActor {
  const admin = (request as any).admin;
  return {
    id: admin?.id || 'unknown',
    role: admin?.role || 'ADMIN',
    email: admin?.email,
  };
}

/**
 * Register ML Governance routes
 */
export async function adminMlGovernanceRoutes(app: FastifyInstance) {
  
  // ============================================
  // LIST ENDPOINTS
  // ============================================
  
  /**
   * GET /api/admin/ml/approvals/pending
   * List models pending approval
   */
  app.get<{ Querystring: QueryFilters }>(
    '/api/admin/ml/approvals/pending',
    async (request, reply) => {
      try {
        const { task, network } = request.query;
        const items = await mlGovernanceService.listPending({ task, network });
        
        return reply.send({
          ok: true,
          data: { items, count: items.length }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/candidates
   * List all promotion candidates (SHADOW + PASS)
   */
  app.get<{ Querystring: QueryFilters }>(
    '/api/admin/ml/approvals/candidates',
    async (request, reply) => {
      try {
        const { task, network } = request.query;
        const items = await mlGovernanceService.listCandidates({ task, network });
        
        return reply.send({
          ok: true,
          data: { items, count: items.length }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/active/:task/:network
   * Get current ACTIVE model for task/network
   */
  app.get<{ Params: TaskNetworkParams }>(
    '/api/admin/ml/approvals/active/:task/:network',
    async (request, reply) => {
      try {
        const { task, network } = request.params;
        const active = await mlGovernanceService.getActiveModel(task, network);
        
        return reply.send({
          ok: true,
          data: active
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/model/:modelId
   * Get single model details
   */
  app.get<{ Params: { modelId: string } }>(
    '/api/admin/ml/approvals/model/:modelId',
    async (request, reply) => {
      try {
        const { modelId } = request.params;
        const model = await mlGovernanceService.getModel(modelId);
        
        if (!model) {
          return reply.status(404).send({
            ok: false,
            error: 'MODEL_NOT_FOUND'
          });
        }
        
        const canPromote = await mlGovernanceService.canPromote(modelId);
        
        return reply.send({
          ok: true,
          data: { ...model, canPromote: canPromote.ok }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  // ============================================
  // ACTION ENDPOINTS
  // ============================================

  /**
   * POST /api/admin/ml/approvals/request
   * Request approval for a model
   */
  app.post<{ Body: ApprovalBody }>(
    '/api/admin/ml/approvals/request',
    async (request, reply) => {
      try {
        const { modelId, note } = request.body || {};
        
        if (!modelId) {
          return reply.status(400).send({
            ok: false,
            error: 'MODEL_ID_REQUIRED'
          });
        }
        
        const actor = getActor(request);
        const model = await mlGovernanceService.requestApproval(modelId, actor, note);
        
        return reply.send({
          ok: true,
          message: 'Approval requested',
          data: model
        });
      } catch (error: any) {
        const status = error.message.includes('NOT_FOUND') ? 404 : 400;
        return reply.status(status).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * POST /api/admin/ml/approvals/approve
   * Approve a model for promotion
   */
  app.post<{ Body: ApprovalBody }>(
    '/api/admin/ml/approvals/approve',
    async (request, reply) => {
      try {
        const { modelId, note } = request.body || {};
        
        if (!modelId) {
          return reply.status(400).send({
            ok: false,
            error: 'MODEL_ID_REQUIRED'
          });
        }
        
        const actor = getActor(request);
        const model = await mlGovernanceService.approve(modelId, actor, note);
        
        return reply.send({
          ok: true,
          message: 'Model approved',
          data: model
        });
      } catch (error: any) {
        const status = error.message.includes('NOT_FOUND') ? 404 : 400;
        return reply.status(status).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * POST /api/admin/ml/approvals/reject
   * Reject a model
   */
  app.post<{ Body: ApprovalBody }>(
    '/api/admin/ml/approvals/reject',
    async (request, reply) => {
      try {
        const { modelId, note } = request.body || {};
        
        if (!modelId) {
          return reply.status(400).send({
            ok: false,
            error: 'MODEL_ID_REQUIRED'
          });
        }
        
        const actor = getActor(request);
        const model = await mlGovernanceService.reject(modelId, actor, note);
        
        return reply.send({
          ok: true,
          message: 'Model rejected',
          data: model
        });
      } catch (error: any) {
        const status = error.message.includes('NOT_FOUND') ? 404 : 400;
        return reply.status(status).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/can-promote/:modelId
   * Check if model can be promoted
   */
  app.get<{ Params: { modelId: string } }>(
    '/api/admin/ml/approvals/can-promote/:modelId',
    async (request, reply) => {
      try {
        const { modelId } = request.params;
        const result = await mlGovernanceService.canPromote(modelId);
        
        return reply.send({
          ok: true,
          canPromote: result.ok,
          reason: result.reason
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/history
   * Get approval action history
   */
  app.get<{ Querystring: QueryFilters & { action?: string; limit?: string } }>(
    '/api/admin/ml/approvals/history',
    async (request, reply) => {
      try {
        const { task, network, action, limit } = request.query;
        const history = await mlGovernanceService.getHistory({
          task,
          network,
          action: action as any,
          limit: limit ? parseInt(limit) : undefined,
        });
        
        return reply.send({
          ok: true,
          data: { items: history, count: history.length }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/active-models
   * Get all ACTIVE models
   */
  app.get(
    '/api/admin/ml/approvals/active-models',
    async (request, reply) => {
      try {
        const models = await mlGovernanceService.listActiveModels();
        
        return reply.send({
          ok: true,
          data: { items: models, count: models.length }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );

  /**
   * GET /api/admin/ml/approvals/rollback-targets/:task
   * Get available rollback targets
   */
  app.get<{ Params: { task: MlTask }; Querystring: { network?: string } }>(
    '/api/admin/ml/approvals/rollback-targets/:task',
    async (request, reply) => {
      try {
        const { task } = request.params;
        const { network } = request.query;
        const targets = await mlGovernanceService.getRollbackTargets(task, network);
        
        return reply.send({
          ok: true,
          data: { items: targets, count: targets.length }
        });
      } catch (error: any) {
        return reply.status(500).send({
          ok: false,
          error: error.message
        });
      }
    }
  );
}
