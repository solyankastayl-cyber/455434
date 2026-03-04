/**
 * BLOCK 48.5 — Playbook Routes
 * Admin endpoints for playbook recommendations
 */

import { FastifyInstance } from 'fastify';
import {
  PlaybookContext,
  PlaybookApplyRequest,
} from './playbook.types.js';
import { recommendPlaybook, evaluateAllRules } from './playbook.engine.js';
import { applyPlaybook, getPlaybookHistory } from './playbook.apply.service.js';
import { getGuardStatus, buildGuardContext } from '../guard.service.js';
import { GovernanceMode, HealthLevel, ReliabilityBadge } from '../guard.types.js';

// ═══════════════════════════════════════════════════════════════
// BUILD PLAYBOOK CONTEXT
// ═══════════════════════════════════════════════════════════════

async function buildPlaybookContext(symbol: string): Promise<PlaybookContext> {
  // Get guard status
  const guardStatus = await getGuardStatus(symbol);
  const guardCtx = await buildGuardContext(symbol);
  
  // Build playbook context from guard data
  const ctx: PlaybookContext = {
    symbol,
    
    governanceMode: guardStatus.mode,
    degenerationScore: guardStatus.lastDecision?.degenerationScore || 0,
    catastrophicTriggered: guardStatus.lastDecision?.catastrophicTriggered || false,
    guardReasons: guardStatus.lastDecision?.reasons || [],
    
    health: guardCtx.health,
    healthStreak: guardCtx.healthStreak,
    healthWatchDays: guardCtx.health === 'WATCH' ? guardCtx.healthStreak : 0,
    
    reliability: guardCtx.reliability,
    calibration: {
      badge: guardCtx.calibration.badge,
      ece: guardCtx.calibration.ece,
    },
    tailRisk: {
      p95MaxDD: guardCtx.tailRisk.p95MaxDD,
      worstDD: guardCtx.tailRisk.worstDD,
    },
    perfWindows: {
      sharpe60d: guardCtx.perfWindows.sharpe60d,
      maxDD60d: guardCtx.perfWindows.maxDD60d,
    },
    drift: guardCtx.drift,
    
    consecutiveHealthyDays: guardCtx.health === 'HEALTHY' ? guardCtx.healthStreak : 0,
  };
  
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function playbookRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/playbook/recommend
   * Get playbook recommendation based on current state
   */
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/fractal/v2.1/admin/playbook/recommend',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      
      const ctx = await buildPlaybookContext(symbol);
      const decision = recommendPlaybook(ctx);
      
      return {
        ok: true,
        symbol,
        context: {
          governanceMode: ctx.governanceMode,
          health: ctx.health,
          degenerationScore: ctx.degenerationScore,
          reliability: ctx.reliability.badge,
          calibration: ctx.calibration.badge,
        },
        decision,
      };
    }
  );
  
  /**
   * GET /api/fractal/v2.1/admin/playbook/evaluate-all
   * Evaluate all rules (for visibility)
   */
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/fractal/v2.1/admin/playbook/evaluate-all',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      
      const ctx = await buildPlaybookContext(symbol);
      const result = evaluateAllRules(ctx);
      
      return {
        ok: true,
        symbol,
        context: ctx,
        result,
      };
    }
  );
  
  /**
   * POST /api/fractal/v2.1/admin/playbook/apply
   * Apply a playbook decision
   */
  fastify.post<{ 
    Body: PlaybookApplyRequest & { symbol?: string } 
  }>(
    '/api/fractal/v2.1/admin/playbook/apply',
    async (request) => {
      const body = request.body || {};
      const symbol = body.symbol || 'BTC';
      
      if (!body.type) {
        return { ok: false, error: 'type is required' };
      }
      
      // Get current recommendation
      const ctx = await buildPlaybookContext(symbol);
      const decision = recommendPlaybook(ctx);
      
      // Verify type matches (optional, for safety)
      if (body.type !== decision.type) {
        // Allow override, but log warning
        console.warn(`[Playbook] Applying ${body.type} but recommendation is ${decision.type}`);
      }
      
      // Apply
      const result = await applyPlaybook(symbol, decision, {
        type: body.type,
        confirm: body.confirm || false,
        actor: body.actor || 'ADMIN',
        reason: body.reason,
      });
      
      return result;
    }
  );
  
  /**
   * GET /api/fractal/v2.1/admin/playbook/history
   * Get playbook application history
   */
  fastify.get<{ 
    Querystring: { symbol?: string; from?: string; to?: string; limit?: string } 
  }>(
    '/api/fractal/v2.1/admin/playbook/history',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      
      const history = await getPlaybookHistory(symbol, {
        from: request.query.from ? parseInt(request.query.from) : undefined,
        to: request.query.to ? parseInt(request.query.to) : undefined,
        limit: request.query.limit ? parseInt(request.query.limit) : 100,
      });
      
      return {
        ok: true,
        symbol,
        count: history.length,
        history,
      };
    }
  );
  
  console.log('[Fractal] BLOCK 48: Playbook routes registered (recommend/evaluate-all/apply/history)');
}
