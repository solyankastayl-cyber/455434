/**
 * DXY FORWARD PERFORMANCE ROUTES
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ═══════════════════════════════════════════════════════════════
// REGISTER ROUTES
// ═══════════════════════════════════════════════════════════════

export async function registerDxyForwardRoutes(fastify: FastifyInstance) {
  const prefix = '/api/fractal/dxy/forward';
  
  /**
   * GET /api/fractal/dxy/forward/summary
   * 
   * Forward performance metrics summary
   */
  fastify.get(`${prefix}/summary`, async (req: FastifyRequest, reply: FastifyReply) => {
    // DXY Forward Performance is D4 - return default for now
    return {
      ok: true,
      asset: 'DXY',
      asOf: new Date().toISOString(),
      window: 'ALL_TIME',
      overall: {
        hitRate: 0,
        avgReturn: 0,
        avgForecastReturn: 0,
        bias: 0,
        trades: 0,
      },
      byHorizon: [
        { horizonDays: 7, hitRate: 0, avgReturn: 0, trades: 0 },
        { horizonDays: 14, hitRate: 0, avgReturn: 0, trades: 0 },
        { horizonDays: 30, hitRate: 0, avgReturn: 0, trades: 0 },
      ],
      updatedAt: new Date().toISOString(),
      note: 'DXY Forward Performance coming in D4 phase.',
    };
  });
  
  /**
   * GET /api/fractal/dxy/forward/equity
   * 
   * Equity curve data
   */
  fastify.get(`${prefix}/equity`, async (req: FastifyRequest, reply: FastifyReply) => {
    return {
      ok: true,
      equity: [],
      maxDD: 0,
      trades: 0,
      winRate: 0,
      note: 'DXY Equity curve coming in D4 phase.',
    };
  });
  
  /**
   * GET /api/fractal/dxy/forward/metrics
   * 
   * Detailed forward metrics
   */
  fastify.get(`${prefix}/metrics`, async (req: FastifyRequest, reply: FastifyReply) => {
    return {
      ok: true,
      asset: 'DXY',
      metrics: {
        totalSignals: 0,
        resolvedSignals: 0,
        pendingSignals: 0,
        hitRate: 0,
        avgReturn: 0,
      },
      note: 'DXY Forward Metrics coming in D4 phase.',
    };
  });
  
  console.log('[DXY] Forward Performance routes registered at /api/fractal/dxy/forward/*');
}

export default registerDxyForwardRoutes;
