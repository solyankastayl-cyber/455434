/**
 * BLOCK 79 — Proposal Routes
 * 
 * API endpoints for proposal lifecycle:
 * - Create/List proposals
 * - Apply (LIVE-only)
 * - Reject
 * - Rollback
 * - Audit trail
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { proposalStoreService } from './services/proposal-store.service.js';
import { proposalApplyService } from './services/proposal-apply.service.js';
import { proposalRollbackService } from './services/proposal-rollback.service.js';
import { policyStateService } from './services/policy-state.service.js';
import { ProposalBuilderService } from '../learning/proposal.builder.js';

interface ProposeBody {
  symbol?: string;
  preset?: string;
  role?: string;
  focus?: string;
  source?: string;
  window?: number;
}

interface ApplyBody {
  reason?: string;
  actor?: string;
}

interface RejectBody {
  reason: string;
  actor?: string;
}

interface RollbackBody {
  reason?: string;
  actor?: string;
}

interface ListQuery {
  status?: string;
  source?: string;
  symbol?: string;
  preset?: string;
  limit?: string;
  skip?: string;
}

export async function proposalRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Instantiate the proposal builder
  const proposalBuilder = new ProposalBuilderService();
  
  // ═══════════════════════════════════════════════════════════════
  // PROPOSAL ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/fractal/v2.1/admin/proposal/propose
   * 
   * Generate and persist a new proposal
   */
  fastify.post('/api/fractal/v2.1/admin/proposal/propose', async (
    request: FastifyRequest<{ Body: ProposeBody }>
  ) => {
    const body = request.body || {};
    const symbol = String(body.symbol ?? 'BTC');
    const preset = String(body.preset ?? 'balanced');
    const role = String(body.role ?? 'ACTIVE');
    const focus = String(body.focus ?? '30d');
    const source = String(body.source ?? 'LIVE') as any;
    const window = Number(body.window ?? 90);
    
    try {
      // 1. Generate proposal using existing engine
      const engineResult = await proposalBuilder.buildDryRunProposal({
        symbol, 
        windowDays: window,
        preset, 
        role,
      });
      
      // 2. Convert deltas to the format expected by store
      const deltasObj: any = {};
      if (engineResult.deltas) {
        for (const delta of engineResult.deltas) {
          const [category, key] = delta.path.split('.');
          if (!deltasObj[category]) deltasObj[category] = {};
          deltasObj[category][key] = delta.to - delta.from;
        }
      }
      
      // 3. Persist proposal
      const proposal = await proposalStoreService.create({
        source,
        scope: { symbol, preset, role, focus },
        learningVectorSnapshot: {},
        deltas: deltasObj,
        simulation: {
          sharpeDelta: engineResult.headline?.expectedImpact?.sharpeDelta || 0,
          hitRateDelta: engineResult.headline?.expectedImpact?.hitRateDelta || 0,
          maxDdDelta: engineResult.headline?.expectedImpact?.maxDDDelta || 0,
          equityDelta: 0,
          passed: engineResult.simulation?.passed || false,
          notes: engineResult.simulation?.notes || [],
        },
        guardrails: {
          liveSamplesOk: engineResult.guardrails?.liveSamplesOk || false,
          driftOk: engineResult.guardrails?.driftOk !== false,
          crisisShareOk: engineResult.guardrails?.crisisShareOk !== false,
          calibrationOk: engineResult.guardrails?.calibrationOk !== false,
          eligible: engineResult.guardrails?.eligible || false,
          reasons: engineResult.guardrails?.reasons || [],
        },
        verdict: engineResult.headline?.verdict || 'HOLD',
        createdBy: 'ADMIN',
      });
      
      return {
        ok: true,
        proposal,
        message: 'Proposal created and persisted',
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Proposal] Create error');
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/proposal/list
   * 
   * List proposals with filters
   */
  fastify.get('/api/fractal/v2.1/admin/proposal/list', async (
    request: FastifyRequest<{ Querystring: ListQuery }>
  ) => {
    const query = request.query || {};
    
    try {
      const result = await proposalStoreService.list({
        status: query.status as any,
        source: query.source as any,
        symbol: query.symbol,
        preset: query.preset,
        limit: query.limit ? parseInt(query.limit) : 50,
        skip: query.skip ? parseInt(query.skip) : 0,
      });
      
      return {
        ok: true,
        ...result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/proposal/latest
   * 
   * Get most recent proposal
   */
  fastify.get('/api/fractal/v2.1/admin/proposal/latest', async (
    request: FastifyRequest<{ Querystring: { status?: string; source?: string } }>
  ) => {
    const query = request.query || {};
    
    try {
      const proposal = await proposalStoreService.getLatest({
        status: query.status as any,
        source: query.source as any,
      });
      
      return {
        ok: true,
        proposal,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/proposal/:proposalId
   * 
   * Get proposal by ID
   */
  fastify.get('/api/fractal/v2.1/admin/proposal/:proposalId', async (
    request: FastifyRequest<{ Params: { proposalId: string } }>
  ) => {
    const { proposalId } = request.params;
    
    try {
      const proposal = await proposalStoreService.getById(proposalId);
      
      if (!proposal) {
        return { ok: false, error: 'Proposal not found' };
      }
      
      return { ok: true, proposal };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/proposal/apply/:proposalId
   * 
   * Apply a proposal (LIVE-only, governance lock enforced)
   */
  fastify.post('/api/fractal/v2.1/admin/proposal/apply/:proposalId', async (
    request: FastifyRequest<{ Params: { proposalId: string }; Body: ApplyBody }>
  ) => {
    const { proposalId } = request.params;
    const body = request.body || {};
    
    try {
      const result = await proposalApplyService.apply({
        proposalId,
        actor: body.actor || 'ADMIN',
        reason: body.reason,
      });
      
      return {
        ok: true,
        ...result,
        message: 'Proposal applied successfully',
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Proposal] Apply error');
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/proposal/reject/:proposalId
   * 
   * Reject a proposal
   */
  fastify.post('/api/fractal/v2.1/admin/proposal/reject/:proposalId', async (
    request: FastifyRequest<{ Params: { proposalId: string }; Body: RejectBody }>
  ) => {
    const { proposalId } = request.params;
    const body = request.body || {};
    
    if (!body.reason) {
      return { ok: false, error: 'Reason is required for rejection' };
    }
    
    try {
      const proposal = await proposalStoreService.markRejected(
        proposalId,
        body.reason,
        body.actor || 'ADMIN'
      );
      
      if (!proposal) {
        return { ok: false, error: 'Proposal not found' };
      }
      
      return {
        ok: true,
        proposal,
        message: 'Proposal rejected',
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // POLICY STATE ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/fractal/v2.1/admin/policy/current
   * 
   * Get current policy state
   */
  fastify.get('/api/fractal/v2.1/admin/policy/current', async () => {
    try {
      const policy = policyStateService.getPolicy();
      const hash = policyStateService.getHash();
      
      return {
        ok: true,
        policy,
        hash,
        version: policyStateService.getVersion(),
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/policy/applications
   * 
   * Get audit trail of applied proposals
   */
  fastify.get('/api/fractal/v2.1/admin/policy/applications', async (
    request: FastifyRequest<{ Querystring: { proposalId?: string; limit?: string; skip?: string } }>
  ) => {
    const query = request.query || {};
    
    try {
      const result = await proposalApplyService.listApplications({
        proposalId: query.proposalId,
        limit: query.limit ? parseInt(query.limit) : 50,
        skip: query.skip ? parseInt(query.skip) : 0,
      });
      
      return {
        ok: true,
        ...result,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/policy/rollback/:applicationId
   * 
   * Rollback a policy application
   */
  fastify.post('/api/fractal/v2.1/admin/policy/rollback/:applicationId', async (
    request: FastifyRequest<{ Params: { applicationId: string }; Body: RollbackBody }>
  ) => {
    const { applicationId } = request.params;
    const body = request.body || {};
    
    try {
      const result = await proposalRollbackService.rollback({
        applicationId,
        actor: body.actor || 'ADMIN',
        reason: body.reason,
      });
      
      return {
        ok: true,
        ...result,
        message: 'Policy rolled back successfully',
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Proposal] Rollback error');
      return { ok: false, error: err.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/proposal/stats
   * 
   * Get proposal statistics
   */
  fastify.get('/api/fractal/v2.1/admin/proposal/stats', async () => {
    try {
      const stats = await proposalStoreService.getStats();
      
      return {
        ok: true,
        stats,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  });

  fastify.log.info('[Fractal] BLOCK 79: Proposal Persistence routes registered');
}

export default proposalRoutes;
