/**
 * BLOCK 78.1 — Drift Intelligence Routes
 * 
 * API endpoints for drift analysis.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { driftService } from './drift.service.js';
import { DriftScope } from './drift.types.js';

interface DriftQuery {
  symbol?: string;
  focus?: string;
  preset?: string;
  role?: string;
  window?: string;
}

export async function driftRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/drift
   * 
   * Get drift analysis comparing cohorts (LIVE vs V2020 vs V2014)
   */
  fastify.get('/api/fractal/v2.1/admin/drift', async (
    request: FastifyRequest<{ Querystring: DriftQuery }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    const focus = String(request.query.focus ?? 'all');
    const preset = String(request.query.preset ?? 'all');
    const role = String(request.query.role ?? 'ACTIVE') as 'ACTIVE' | 'SHADOW';
    const windowDays = Number(request.query.window ?? 365);
    
    const scope: DriftScope = {
      symbol,
      focus,
      preset,
      role,
      windowDays,
    };
    
    try {
      const payload = await driftService.build(scope);
      
      return {
        ok: true,
        ...payload,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * GET /api/fractal/v2.1/admin/drift/summary
   * 
   * Quick drift severity check (for TG alerts, governance checks)
   */
  fastify.get('/api/fractal/v2.1/admin/drift/summary', async (
    request: FastifyRequest<{ Querystring: DriftQuery }>
  ) => {
    const symbol = String(request.query.symbol ?? 'BTC');
    
    const scope: DriftScope = {
      symbol,
      focus: 'all',
      preset: 'all',
      role: 'ACTIVE',
      windowDays: 365,
    };
    
    try {
      const payload = await driftService.build(scope);
      
      return {
        ok: true,
        symbol,
        overallSeverity: payload.verdict.overallSeverity,
        recommendation: payload.verdict.recommendation,
        comparisons: payload.comparisons.map(c => ({
          pair: c.pair,
          severity: c.severity,
          hitRatePP: c.deltas.hitRatePP.toFixed(1),
          calibrationPP: c.deltas.calibrationPP.toFixed(1),
          reasons: c.reasons,
        })),
        meta: payload.meta,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  fastify.log.info('[Fractal] BLOCK 78: Drift Intelligence routes registered');
}

export default driftRoutes;
