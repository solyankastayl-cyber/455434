/**
 * Admin ML Validation Routes - ML v2.1 STEP 1
 * 
 * API endpoints for ML validation management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAdminAuth } from '../admin/admin.middleware.js';
import { 
  getOutcomesSummary, 
  getRecentOutcomes 
} from './validation/validation.service.js';
import { triggerValidation } from '../../jobs/ml_signal_validation.job.js';
import { SignalOutcomeModel } from './validation/signal_outcome.model.js';
import { 
  computeAllSnapshots, 
  getLatestSnapshots, 
  getAccuracyHistory 
} from './validation/accuracy.service.js';
import { 
  runAllDriftDetection, 
  getRecentDrifts, 
  acknowledgeDrift,
  getDriftSummary 
} from './validation/drift.service.js';
import {
  getAllPolicies,
  getPolicyById,
  upsertPolicy,
  deletePolicy,
  togglePolicy,
  evaluateAllPolicies,
  getExecutionHistory,
  triggerManualRetrain,
  getRetrainSummary,
  ensureDefaultPolicy,
} from './validation/retrain.service.js';

// ============================================
// TYPES
// ============================================

interface OutcomesQuery {
  network?: string;
  modelVersion?: string;
  horizon?: '1h' | '4h' | '24h';
  outcome?: 'CORRECT' | 'WRONG' | 'NEUTRAL' | 'SKIPPED';
  days?: string;
  limit?: string;
}

// ============================================
// ROUTES
// ============================================

export async function adminMLValidationRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /admin/ml/outcomes
   * Get recent outcomes with filters
   */
  app.get(
    '/ml/outcomes',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: OutcomesQuery }>, reply: FastifyReply) => {
      try {
        const { network, outcome, limit = '50' } = request.query;
        
        const outcomes = await getRecentOutcomes(
          Math.min(parseInt(limit) || 50, 200),
          network,
          outcome as any
        );
        
        return reply.send({ 
          ok: true, 
          data: outcomes.map(o => ({
            ...o,
            _id: undefined, // Remove MongoDB ID
          }))
        });
      } catch (err: any) {
        console.error('[AdminML] Outcomes error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'OUTCOMES_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /admin/ml/outcomes/summary
   * Get aggregated summary
   */
  app.get(
    '/ml/outcomes/summary',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: OutcomesQuery }>, reply: FastifyReply) => {
      try {
        const { network, modelVersion, horizon, days = '7' } = request.query;
        
        const summary = await getOutcomesSummary(
          network,
          modelVersion,
          horizon as any,
          parseInt(days) || 7
        );
        
        return reply.send({ ok: true, data: summary });
      } catch (err: any) {
        console.error('[AdminML] Summary error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'SUMMARY_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * POST /admin/ml/validation/trigger
   * Manually trigger validation
   */
  app.post(
    '/ml/validation/trigger',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: { network?: string; limit?: number } }>, reply: FastifyReply) => {
      try {
        const { network, limit = 50 } = request.body || {};
        
        const result = await triggerValidation(network, Math.min(limit, 100));
        
        return reply.send({ 
          ok: true, 
          data: {
            processed: result.processed,
            results: result.results.slice(0, 20), // Limit response size
          },
          message: `Validated ${result.processed} signals`
        });
      } catch (err: any) {
        console.error('[AdminML] Trigger error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'TRIGGER_ERROR',
          message: err.message,
        });
      }
    }
  );

  /**
   * GET /admin/ml/validation/stats
   * Get validation statistics by network
   */
  app.get(
    '/ml/validation/stats',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await SignalOutcomeModel.aggregate([
          {
            $group: {
              _id: { network: '$network', outcome: '$outcome' },
              count: { $sum: 1 },
              avgConfidence: { $avg: '$confidence' },
            },
          },
          {
            $group: {
              _id: '$_id.network',
              outcomes: {
                $push: {
                  outcome: '$_id.outcome',
                  count: '$count',
                  avgConfidence: '$avgConfidence',
                },
              },
              total: { $sum: '$count' },
            },
          },
          { $sort: { total: -1 } },
        ]);
        
        // Calculate accuracy per network
        const data = stats.map((s: any) => {
          const outcomes = s.outcomes.reduce((acc: any, o: any) => {
            acc[o.outcome] = o.count;
            return acc;
          }, {});
          
          const correct = outcomes.CORRECT || 0;
          const wrong = outcomes.WRONG || 0;
          const evaluated = correct + wrong;
          
          return {
            network: s._id,
            total: s.total,
            correct,
            wrong,
            neutral: outcomes.NEUTRAL || 0,
            skipped: outcomes.SKIPPED || 0,
            accuracy: evaluated > 0 ? correct / evaluated : 0,
          };
        });
        
        return reply.send({ ok: true, data });
      } catch (err: any) {
        console.error('[AdminML] Stats error:', err.message);
        return reply.code(500).send({
          ok: false,
          error: 'STATS_ERROR',
          message: err.message,
        });
      }
    }
  );

  // ==========================================
  // STEP 2: ACCURACY & DRIFT ENDPOINTS
  // ==========================================

  /**
   * GET /admin/ml/accuracy/snapshots
   * Get latest accuracy snapshots per network
   */
  app.get(
    '/ml/accuracy/snapshots',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { window?: string } }>, reply: FastifyReply) => {
      try {
        const { window = '7d' } = request.query;
        const snapshots = await getLatestSnapshots(window as any);
        return reply.send({ ok: true, data: snapshots });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/accuracy/history
   * Get accuracy history for a network
   */
  app.get(
    '/ml/accuracy/history',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { network: string; window?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const { network, window = '7d', limit = '30' } = request.query;
        const history = await getAccuracyHistory(network, window as any, parseInt(limit));
        return reply.send({ ok: true, data: history });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/accuracy/compute
   * Manually trigger accuracy snapshot computation
   */
  app.post(
    '/ml/accuracy/compute',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await computeAllSnapshots(['1d', '7d']);
        return reply.send({ ok: true, data: result, message: `Computed ${result.computed} snapshots` });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/drift
   * Get recent drift events
   */
  app.get(
    '/ml/drift',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
      try {
        const { limit = '20' } = request.query;
        const drifts = await getRecentDrifts(parseInt(limit));
        return reply.send({ ok: true, data: drifts });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/drift/summary
   * Get drift summary
   */
  app.get(
    '/ml/drift/summary',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const summary = await getDriftSummary();
        return reply.send({ ok: true, data: summary });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/drift/detect
   * Manually trigger drift detection
   */
  app.post(
    '/ml/drift/detect',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await runAllDriftDetection();
        return reply.send({ ok: true, data: result, message: `Checked ${result.checked} networks, found ${result.drifts} drifts` });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/drift/:id/acknowledge
   * Acknowledge a drift event
   */
  app.post(
    '/ml/drift/:id/acknowledge',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { id: string }; Body: { action?: string } }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const { action = 'NONE' } = request.body || {};
        const admin = (request as any).admin?.username || 'admin';
        
        const event = await acknowledgeDrift(id, admin, action as any);
        if (!event) {
          return reply.code(404).send({ ok: false, error: 'Drift event not found' });
        }
        
        return reply.send({ ok: true, data: event });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  // ============================================
  // STEP 3: RETRAIN POLICY ROUTES
  // ============================================

  // Ensure default policy exists
  await ensureDefaultPolicy();

  /**
   * GET /admin/ml/retrain/policies
   * Get all retrain policies
   */
  app.get(
    '/ml/retrain/policies',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const policies = await getAllPolicies();
        return reply.send({ ok: true, data: policies });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/retrain/policies/:policyId
   * Get specific policy
   */
  app.get(
    '/ml/retrain/policies/:policyId',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Params: { policyId: string } }>, reply: FastifyReply) => {
      try {
        const policy = await getPolicyById(request.params.policyId);
        if (!policy) {
          return reply.code(404).send({ ok: false, error: 'Policy not found' });
        }
        return reply.send({ ok: true, data: policy });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/retrain/policies
   * Create or update policy
   */
  app.post(
    '/ml/retrain/policies',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Body: any }>, reply: FastifyReply) => {
      try {
        const policy = await upsertPolicy(request.body);
        return reply.send({ ok: true, data: policy });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * DELETE /admin/ml/retrain/policies/:policyId
   * Delete policy
   */
  app.delete(
    '/ml/retrain/policies/:policyId',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { policyId: string } }>, reply: FastifyReply) => {
      try {
        const deleted = await deletePolicy(request.params.policyId);
        if (!deleted) {
          return reply.code(404).send({ ok: false, error: 'Policy not found' });
        }
        return reply.send({ ok: true, message: 'Policy deleted' });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/retrain/policies/:policyId/toggle
   * Enable/disable policy
   */
  app.post(
    '/ml/retrain/policies/:policyId/toggle',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { policyId: string }; Body: { enabled: boolean } }>, reply: FastifyReply) => {
      try {
        const { enabled } = request.body || {};
        const policy = await togglePolicy(request.params.policyId, enabled);
        if (!policy) {
          return reply.code(404).send({ ok: false, error: 'Policy not found' });
        }
        return reply.send({ ok: true, data: policy });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/retrain/evaluate
   * Evaluate all policies for triggers
   */
  app.post(
    '/ml/retrain/evaluate',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await evaluateAllPolicies();
        return reply.send({ ok: true, data: result });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * POST /admin/ml/retrain/trigger/:policyId
   * Manually trigger retrain
   */
  app.post(
    '/ml/retrain/trigger/:policyId',
    { preHandler: [requireAdminAuth(['ADMIN'])] },
    async (request: FastifyRequest<{ Params: { policyId: string } }>, reply: FastifyReply) => {
      try {
        const admin = (request as any).admin?.username || 'admin';
        const result = await triggerManualRetrain(request.params.policyId, admin);
        
        if (!result.success) {
          return reply.code(400).send({ ok: false, error: result.message });
        }
        
        return reply.send({ ok: true, data: result });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/retrain/history
   * Get execution history
   */
  app.get(
    '/ml/retrain/history',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest<{ Querystring: { policyId?: string; network?: string; limit?: string } }>, reply: FastifyReply) => {
      try {
        const { policyId, network, limit = '50' } = request.query;
        const history = await getExecutionHistory({ policyId, network, limit: parseInt(limit) });
        return reply.send({ ok: true, data: history });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  /**
   * GET /admin/ml/retrain/summary
   * Get retrain summary
   */
  app.get(
    '/ml/retrain/summary',
    { preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const summary = await getRetrainSummary();
        return reply.send({ ok: true, data: summary });
      } catch (err: any) {
        return reply.code(500).send({ ok: false, error: err.message });
      }
    }
  );

  console.log('[Admin] ML Validation routes registered (incl. STEP 3 Retrain)');
}

export default adminMLValidationRoutes;
