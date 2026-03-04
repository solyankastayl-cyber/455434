/**
 * BLOCK 73.6 — Phase Performance Routes
 * 
 * Endpoint: GET /api/fractal/v2.1/admin/phase-performance
 * 
 * Provides phase-by-phase performance attribution
 * based on resolved forward-truth data.
 */

import { FastifyInstance } from 'fastify';
import { phasePerformanceService, type Tier, type Role, type Preset } from './phase-performance.service.js';

export async function phasePerformanceRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/phase-performance
   * 
   * Phase Performance Heatmap Data
   * 
   * Query params:
   * - symbol: string (default: BTC)
   * - tier: TIMING | TACTICAL | STRUCTURE (required)
   * - h: specific horizon (7/14/30/90/180/365)
   * - preset: CONSERVATIVE | BALANCED | AGGRESSIVE
   * - role: ACTIVE | SHADOW
   * - from: start date (YYYY-MM-DD)
   * - to: end date (YYYY-MM-DD)
   */
  fastify.get(
    '/api/fractal/v2.1/admin/phase-performance',
    async (request, reply) => {
      try {
        const query = request.query as {
          symbol?: string;
          tier?: string;
          h?: string;
          preset?: string;
          role?: string;
          from?: string;
          to?: string;
        };
        
        const symbol = query.symbol || 'BTC';
        const tier = (query.tier?.toUpperCase() || 'TACTICAL') as Tier;
        const h = query.h ? parseInt(query.h, 10) : undefined;
        const preset = (query.preset?.toUpperCase() || 'BALANCED') as Preset;
        const role = (query.role?.toUpperCase() || 'ACTIVE') as Role;
        
        // Validate tier
        if (!['TIMING', 'TACTICAL', 'STRUCTURE'].includes(tier)) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid tier. Use TIMING, TACTICAL, or STRUCTURE'
          });
        }
        
        // Validate horizon if provided
        if (h && ![7, 14, 30, 90, 180, 365].includes(h)) {
          return reply.status(400).send({
            ok: false,
            error: 'Invalid horizon. Use 7, 14, 30, 90, 180, or 365'
          });
        }
        
        const result = await phasePerformanceService.aggregate({
          symbol,
          tier,
          h,
          preset,
          role,
          from: query.from,
          to: query.to
        });
        
        return {
          ok: true,
          ...result
        };
        
      } catch (err: any) {
        console.error('[PhasePerformance] Error:', err);
        return reply.status(500).send({
          ok: false,
          error: err.message || 'Internal server error'
        });
      }
    }
  );
  
  console.log('[Fractal] BLOCK 73.6: Phase Performance endpoint registered (/api/fractal/v2.1/admin/phase-performance)');
}
