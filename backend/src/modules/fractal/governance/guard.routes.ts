/**
 * BLOCK 47.5 — Guard Routes
 * Admin endpoints for guard management
 */

import { FastifyInstance } from 'fastify';
import {
  checkGuard,
  getGuardStatus,
  overrideGuardMode,
  getGuardDecisionHistory,
} from './guard.service.js';
import {
  GuardCheckRequest,
  GuardOverrideRequest,
} from './guard.types.js';

export async function guardRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/guard/check
   * Evaluate guard and optionally apply mode change
   */
  fastify.post<{ Body: GuardCheckRequest }>(
    '/api/fractal/v2.1/admin/guard/check',
    async (request) => {
      const body = request.body || {};
      
      return checkGuard({
        symbol: body.symbol || 'BTC',
        asOf: body.asOf,
        apply: body.apply || false,
        allowAutoProtection: body.allowAutoProtection || false,
      });
    }
  );
  
  /**
   * GET /api/fractal/v2.1/admin/guard/status
   * Get current guard state
   */
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/fractal/v2.1/admin/guard/status',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      return getGuardStatus(symbol);
    }
  );
  
  /**
   * POST /api/fractal/v2.1/admin/guard/override
   * Manually set guard mode (admin action)
   */
  fastify.post<{ Body: GuardOverrideRequest & { symbol?: string } }>(
    '/api/fractal/v2.1/admin/guard/override',
    async (request) => {
      const body = request.body || {};
      const symbol = body.symbol || 'BTC';
      
      if (!body.mode) {
        return { ok: false, error: 'mode is required' };
      }
      
      return overrideGuardMode(symbol, {
        mode: body.mode,
        reason: body.reason || 'Admin override',
        actor: body.actor || 'ADMIN',
      });
    }
  );
  
  /**
   * GET /api/fractal/v2.1/admin/guard/history
   * Get guard decision history
   */
  fastify.get<{ Querystring: { symbol?: string; from?: string; to?: string; limit?: string } }>(
    '/api/fractal/v2.1/admin/guard/history',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      
      return getGuardDecisionHistory(symbol, {
        from: request.query.from ? parseInt(request.query.from) : undefined,
        to: request.query.to ? parseInt(request.query.to) : undefined,
        limit: request.query.limit ? parseInt(request.query.limit) : 100,
      });
    }
  );
  
  console.log('[Fractal] BLOCK 47: Guard routes registered (check/status/override/history)');
}
