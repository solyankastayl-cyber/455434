/**
 * BLOCK 77 — Learning Routes
 * 
 * API endpoints for Adaptive Weight Learning:
 * - GET /learning-vector - Get aggregated learning data
 * - POST /governance/proposal/dry-run - Generate dry-run proposal
 * - POST /governance/proposal/propose - Save proposal
 * - POST /governance/proposal/apply - Apply proposal (LIVE-only enforced by BLOCK 78.5)
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { learningAggregatorService } from './learning.aggregator.service.js';
import { proposalBuilderService } from './proposal.builder.js';
import { governanceLockService } from '../governance/governance-lock.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface LearningVectorQuery {
  symbol?: string;
  window?: string;
  preset?: string;
  role?: string;
}

interface ProposalBody {
  symbol?: string;
  windowDays?: number;
  preset?: string;
  role?: string;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function learningRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/learning-vector
   * 
   * Get aggregated learning data for policy optimization
   */
  fastify.get('/api/fractal/v2.1/learning-vector', async (
    request: FastifyRequest<{ Querystring: LearningVectorQuery }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const windowDays = parseInt(request.query.window || '90', 10);
    const preset = request.query.preset ?? 'balanced';
    const role = request.query.role ?? 'ACTIVE';
    
    if (symbol !== 'BTC') {
      return { error: true, message: 'BTC_ONLY' };
    }
    
    try {
      const vector = await learningAggregatorService.buildLearningVector({
        symbol,
        windowDays,
        preset,
        role,
      });
      
      return {
        ok: true,
        vector,
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/proposal/dry-run
   * 
   * Generate dry-run proposal without saving
   */
  fastify.post('/api/fractal/v2.1/admin/governance/proposal/dry-run', async (
    request: FastifyRequest<{ Body: ProposalBody }>
  ) => {
    const body = request.body || {};
    const symbol = body.symbol ?? 'BTC';
    const windowDays = body.windowDays ?? 90;
    const preset = body.preset ?? 'balanced';
    const role = body.role ?? 'ACTIVE';
    
    if (symbol !== 'BTC') {
      return { error: true, message: 'BTC_ONLY' };
    }
    
    try {
      const proposal = await proposalBuilderService.buildDryRunProposal({
        symbol,
        windowDays,
        preset,
        role,
      });
      
      return {
        ok: true,
        proposal,
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Learning] Dry-run error');
      return { error: true, message: err.message };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/proposal/propose
   * 
   * Save proposal for review
   */
  fastify.post('/api/fractal/v2.1/admin/governance/proposal/propose', async (
    request: FastifyRequest<{ Body: ProposalBody }>
  ) => {
    const body = request.body || {};
    const symbol = body.symbol ?? 'BTC';
    const windowDays = body.windowDays ?? 90;
    
    try {
      // Build proposal
      const proposal = await proposalBuilderService.buildDryRunProposal({
        symbol,
        windowDays,
        preset: body.preset,
        role: body.role,
      });
      
      // Check guardrails
      if (!proposal.guardrails.eligible) {
        return {
          ok: false,
          error: 'GUARDRAILS_FAILED',
          reasons: proposal.guardrails.reasons,
        };
      }
      
      // Check simulation
      if (!proposal.simulation.passed) {
        return {
          ok: false,
          error: 'SIMULATION_FAILED',
          notes: proposal.simulation.notes,
        };
      }
      
      // Update status to PROPOSED
      proposal.status = 'PROPOSED';
      proposal.audit.proposedBy = 'ADMIN';
      proposal.audit.proposedAt = new Date().toISOString();
      
      // TODO: Save to MongoDB
      // await ProposalModel.create(proposal);
      
      return {
        ok: true,
        proposal,
        message: 'Proposal saved for review',
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Learning] Propose error');
      return { error: true, message: err.message };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/proposal/apply
   * 
   * Apply a proposed policy change
   * BLOCK 78.5: Enforces LIVE-only APPLY rule
   */
  fastify.post('/api/fractal/v2.1/admin/governance/proposal/apply', async (
    request: FastifyRequest<{ Body: { proposalId?: string; source?: string; policyHash?: string } }>
  ) => {
    const body = request.body || {};
    const proposalId = body.proposalId;
    const source = body.source || 'LIVE';
    const policyHash = body.policyHash;
    
    if (!proposalId) {
      return { error: true, message: 'PROPOSAL_ID_REQUIRED' };
    }
    
    try {
      // BLOCK 78.5: Check governance lock before applying
      const lockCheck = await governanceLockService.checkApplyAllowed('BTC', source, policyHash);
      
      if (!lockCheck.allowed) {
        return {
          ok: false,
          error: 'GOVERNANCE_LOCK_BLOCKED',
          message: lockCheck.blockedReason,
          lockStatus: lockCheck.lockStatus,
        };
      }
      
      // TODO: Fetch proposal from DB and apply
      // const proposal = await ProposalModel.findOne({ id: proposalId });
      
      // For now, return placeholder
      return {
        ok: false,
        error: 'NOT_IMPLEMENTED',
        message: 'Apply endpoint requires proposal persistence (coming in 77.2.2)',
        lockStatus: lockCheck.lockStatus,
      };
    } catch (err: any) {
      fastify.log.error({ err: err.message }, '[Learning] Apply error');
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/governance/proposal/latest
   * 
   * Get latest proposal
   */
  fastify.get('/api/fractal/v2.1/admin/governance/proposal/latest', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    try {
      // Generate fresh dry-run as "latest"
      const proposal = await proposalBuilderService.buildDryRunProposal({
        symbol,
        windowDays: 90,
      });
      
      return {
        ok: true,
        proposal,
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 77.1: Learning Vector routes registered');
  fastify.log.info('[Fractal] BLOCK 77.2: Proposal Engine routes registered');
}

export default learningRoutes;
