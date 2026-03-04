/**
 * BLOCK 78.5 — Governance Lock Routes
 * 
 * API endpoints for LIVE-only APPLY enforcement.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { governanceLockService } from './governance-lock.service.js';

interface LockStatusQuery {
  symbol?: string;
}

interface CheckApplyBody {
  symbol?: string;
  source?: string;
  policyHash?: string;
}

export async function governanceLockRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/governance/lock/status
   * 
   * Get current governance lock status
   */
  fastify.get('/api/fractal/v2.1/admin/governance/lock/status', async (
    request: FastifyRequest<{ Querystring: LockStatusQuery }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    
    try {
      const status = await governanceLockService.getLockStatus(symbol);
      
      return {
        ok: true,
        symbol,
        ...status,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/governance/lock/check-apply
   * 
   * Check if APPLY action is allowed
   */
  fastify.post('/api/fractal/v2.1/admin/governance/lock/check-apply', async (
    request: FastifyRequest<{ Body: CheckApplyBody }>
  ) => {
    const body = request.body || {};
    const symbol = String(body.symbol ?? 'BTC');
    const source = body.source;
    const policyHash = body.policyHash;
    
    try {
      const result = await governanceLockService.checkApplyAllowed(symbol, source, policyHash);
      
      return {
        ok: true,
        symbol,
        ...result,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 78.5: Governance Lock routes registered');
}

export default governanceLockRoutes;
