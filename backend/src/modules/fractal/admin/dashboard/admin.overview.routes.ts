/**
 * BLOCK 49 — Admin Overview Routes
 * Single endpoint for institutional dashboard
 */

import { FastifyInstance } from 'fastify';
import { getAdminOverview } from './admin.overview.service.js';

export async function adminOverviewRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/fractal/v2.1/admin/overview
   * 
   * Single payload for institutional admin dashboard.
   * Aggregates: governance, health, guard, telemetry, model, performance, recommendation, recent.
   * 
   * Frontend calls this ONE endpoint and renders the entire dashboard.
   */
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/fractal/v2.1/admin/overview',
    async (request) => {
      const symbol = request.query.symbol || 'BTC';
      
      try {
        const overview = await getAdminOverview(symbol);
        return overview;
      } catch (error) {
        console.error('[AdminOverview] Error building overview:', error);
        return {
          ok: false,
          error: 'Failed to build admin overview',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );
  
  console.log('[Fractal] BLOCK 49: Admin Overview endpoint registered (/api/fractal/v2.1/admin/overview)');
}
