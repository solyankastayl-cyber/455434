/**
 * BLOCK 75.3 & 75.4 + 75.UI — Attribution & Policy Routes
 * 
 * GET  /api/fractal/v2.1/admin/memory/attribution/summary - Attribution analysis (existing)
 * GET  /api/fractal/v2.1/admin/attribution - Full Attribution Tab data (NEW)
 * GET  /api/fractal/v2.1/admin/governance - Full Governance Tab data (NEW)
 * POST /api/fractal/v2.1/admin/governance/policy/dry-run - Calculate policy changes
 * POST /api/fractal/v2.1/admin/governance/policy/propose - Create policy proposal
 * POST /api/fractal/v2.1/admin/governance/policy/apply - Apply proposal (manual)
 * GET  /api/fractal/v2.1/admin/governance/policy/current - Get current config
 * GET  /api/fractal/v2.1/admin/governance/policy/history - Get policy history
 * GET  /api/fractal/v2.1/admin/governance/policy/pending - Get pending proposals
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { attributionService } from './attribution.service.js';
import { attributionAggregatorService } from './attribution-aggregator.service.js';
import { policyUpdateService, type PolicyUpdateMode } from '../policy/policy-update.service.js';

export async function attributionRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.UI.1: FULL ATTRIBUTION TAB ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/fractal/v2.1/admin/attribution
   * 
   * Single endpoint → entire Attribution tab
   * Returns: headline, tiers, regimes, divergence, phases, insights, guardrails
   * 
   * BLOCK 77.4: Added source parameter for LIVE/BOOTSTRAP filtering
   * BLOCK 77.4: Added asof parameter for bootstrap data viewing
   */
  fastify.get('/api/fractal/v2.1/admin/attribution', async (
    request: FastifyRequest<{
      Querystring: { 
        symbol?: string;
        window?: string;
        preset?: string;
        role?: string;
        source?: string;
        asof?: string;
      }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const window = request.query.window ?? '90d';
    const preset = request.query.preset ?? 'balanced';
    const role = request.query.role ?? 'ACTIVE';
    const source = (request.query.source as 'LIVE' | 'BOOTSTRAP' | 'ALL') || 'ALL';
    const asof = request.query.asof; // Optional: custom end date for bootstrap viewing
    
    try {
      const data = await attributionAggregatorService.getAttributionData(
        symbol,
        window,
        preset,
        role,
        source,
        asof
      );
      
      return data;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.UI.2: FULL GOVERNANCE TAB ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/fractal/v2.1/admin/governance
   * 
   * Single endpoint → entire Governance tab
   * Returns: currentPolicy, proposedChanges, guardrails, auditLog
   */
  fastify.get('/api/fractal/v2.1/admin/governance', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    try {
      const currentConfig = await policyUpdateService.getCurrentConfig();
      const pending = await policyUpdateService.getPendingProposals(symbol);
      const history = await policyUpdateService.getHistory(symbol, 20);
      
      // Get latest proposal if exists
      const proposedChanges = pending.length > 0 ? {
        version: pending[0].version,
        diffs: pending[0].diffs,
        proposedAt: pending[0].proposedAt
      } : null;
      
      // Build audit log
      const auditLog = history.map(p => ({
        id: (p as any)._id.toString(),
        action: p.status as 'DRY_RUN' | 'PROPOSE' | 'APPLY' | 'REJECT',
        timestamp: (p.appliedAt || p.proposedAt).toISOString(),
        actor: p.appliedBy || p.proposedBy || 'system',
        summary: `${p.version}: ${p.diffs?.length || 0} changes`
      }));
      
      // Calculate drift stats from latest proposal
      let driftStats = {
        structuralWeightDrift: 0,
        timingWeightDrift: 0,
        tacticalWeightDrift: 0
      };
      
      if (proposedChanges?.diffs) {
        for (const diff of proposedChanges.diffs) {
          if (diff.field === 'tierWeights.STRUCTURE') {
            driftStats.structuralWeightDrift = diff.changePercent;
          }
          if (diff.field === 'tierWeights.TIMING') {
            driftStats.timingWeightDrift = diff.changePercent;
          }
          if (diff.field === 'tierWeights.TACTICAL') {
            driftStats.tacticalWeightDrift = diff.changePercent;
          }
        }
      }
      
      // Build guardrails
      const guardrails = {
        minSamplesOk: pending.length === 0 || pending[0].guardrailsPass,
        driftWithinLimit: Math.abs(driftStats.structuralWeightDrift) <= 5 &&
                          Math.abs(driftStats.timingWeightDrift) <= 5 &&
                          Math.abs(driftStats.tacticalWeightDrift) <= 5,
        notInCrisis: true, // TODO: check current regime
        canApply: pending.length > 0 && pending[0].guardrailsPass,
        reasons: pending.length > 0 ? pending[0].guardrailViolations : []
      };
      
      return {
        currentPolicy: {
          version: 'v2.1.0',
          tierWeights: currentConfig.tierWeights,
          horizonWeights: currentConfig.horizonWeights,
          regimeMultipliers: currentConfig.regimeMultipliers,
          divergencePenalties: currentConfig.divergencePenalties,
          phaseGradeMultipliers: currentConfig.phaseGradeMultipliers,
          updatedAt: new Date().toISOString()
        },
        proposedChanges,
        driftStats,
        guardrails,
        auditLog
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.3: ATTRIBUTION SUMMARY (legacy)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/fractal/v2.1/admin/memory/attribution/summary
   * 
   * Build attribution summary: which tiers/regimes performed best
   */
  fastify.get('/api/fractal/v2.1/admin/memory/attribution/summary', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; from?: string; to?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    
    try {
      const summary = await attributionService.buildAttributionSummary(symbol, from, to);
      
      return {
        symbol,
        period: summary.period,
        totalOutcomes: summary.totalOutcomes,
        
        tierAccuracy: summary.tierAccuracy.map(t => ({
          tier: t.tier,
          hitRate: Number((t.hitRate * 100).toFixed(1)) + '%',
          total: t.total,
          avgWeightWhenHit: Number(t.avgWeightWhenHit.toFixed(3)),
          avgWeightWhenMiss: Number(t.avgWeightWhenMiss.toFixed(3))
        })),
        dominantTier: summary.dominantTier,
        
        regimeAccuracy: summary.regimeAccuracy.slice(0, 5).map(r => ({
          regime: r.regime,
          hitRate: Number((r.hitRate * 100).toFixed(1)) + '%',
          avgReturn: Number(r.avgReturn.toFixed(2)) + '%',
          total: r.total
        })),
        
        divergenceImpact: summary.divergenceImpact.map(d => ({
          grade: d.grade,
          hitRate: Number((d.hitRate * 100).toFixed(1)) + '%',
          errorRate: Number((d.errorRate * 100).toFixed(1)) + '%',
          total: d.total
        })),
        
        consensusHitRate: Number((summary.consensusHitRate * 100).toFixed(1)) + '%',
        consensusAvgReturn: Number(summary.consensusAvgReturn.toFixed(2)) + '%',
        
        insights: summary.insights
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  // ═══════════════════════════════════════════════════════════════
  // BLOCK 75.4: POLICY GOVERNANCE
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/fractal/v2.1/admin/governance/policy/dry-run
   * 
   * Calculate policy changes without persisting
   */
  fastify.post('/api/fractal/v2.1/admin/governance/policy/dry-run', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; from?: string; to?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    
    try {
      const result = await policyUpdateService.runUpdate(symbol, 'DRY_RUN', from, to);
      return result;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/policy/propose
   * 
   * Create a policy proposal (awaits manual approval)
   */
  fastify.post('/api/fractal/v2.1/admin/governance/policy/propose', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; from?: string; to?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const from = request.query.from;
    const to = request.query.to;
    
    try {
      const result = await policyUpdateService.runUpdate(symbol, 'PROPOSE', from, to);
      return result;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/policy/apply
   * 
   * Apply an approved proposal (manual confirmation)
   */
  fastify.post('/api/fractal/v2.1/admin/governance/policy/apply', async (
    request: FastifyRequest<{
      Body: { proposalId: string; appliedBy?: string }
    }>
  ) => {
    const { proposalId, appliedBy } = request.body || {};
    
    if (!proposalId) {
      return { error: true, message: 'proposalId is required' };
    }
    
    try {
      const result = await policyUpdateService.applyProposal(proposalId, appliedBy || 'admin');
      return result;
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/governance/policy/current
   * 
   * Get current active policy config
   */
  fastify.get('/api/fractal/v2.1/admin/governance/policy/current', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    try {
      const config = await policyUpdateService.getCurrentConfig();
      return { symbol, config };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/governance/policy/history
   * 
   * Get policy proposal history
   */
  fastify.get('/api/fractal/v2.1/admin/governance/policy/history', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string; limit?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    const limit = parseInt(request.query.limit || '10', 10);
    
    try {
      const history = await policyUpdateService.getHistory(symbol, limit);
      return {
        symbol,
        count: history.length,
        proposals: history.map(p => ({
          id: (p as any)._id.toString(),
          version: p.version,
          status: p.status,
          guardrailsPass: p.guardrailsPass,
          resolvedCount: p.windowRange.resolvedCount,
          proposedAt: p.proposedAt,
          appliedAt: p.appliedAt
        }))
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/governance/policy/pending
   * 
   * Get pending policy proposals
   */
  fastify.get('/api/fractal/v2.1/admin/governance/policy/pending', async (
    request: FastifyRequest<{
      Querystring: { symbol?: string }
    }>
  ) => {
    const symbol = request.query.symbol ?? 'BTC';
    
    try {
      const pending = await policyUpdateService.getPendingProposals(symbol);
      return {
        symbol,
        count: pending.length,
        proposals: pending.map(p => ({
          id: (p as any)._id.toString(),
          version: p.version,
          guardrailsPass: p.guardrailsPass,
          guardrailViolations: p.guardrailViolations,
          diffs: p.diffs,
          insights: p.evidenceSummary?.topInsights,
          proposedAt: p.proposedAt
        }))
      };
    } catch (err: any) {
      return { error: true, message: err.message };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 75.3 & 75.4: Attribution & Policy routes registered');
}
