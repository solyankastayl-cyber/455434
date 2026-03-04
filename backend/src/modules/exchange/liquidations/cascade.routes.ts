/**
 * S10.4 — Liquidation Cascade API Routes
 * 
 * Read-only endpoints for cascade detection.
 * NO signals, NO predictions — only structural diagnosis.
 */

import { FastifyInstance } from 'fastify';
import * as cascadeService from './cascade.service.js';

export async function cascadeRoutes(fastify: FastifyInstance): Promise<void> {
  // Get current cascade state for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/liquidation-cascade/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const state = cascadeService.getCascadeState(symbol.toUpperCase());
      
      return {
        ok: true,
        data: {
          status: state.active ? 'ACTIVE' : 'NONE',
          ...state,
        },
      };
    }
  );

  // Get cascade history for symbol
  fastify.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/v10/exchange/liquidation-cascade/history/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const limit = parseInt(request.query.limit || '10');
      const history = cascadeService.getCascadeHistory(symbol.toUpperCase(), limit);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: history.length,
        data: history,
      };
    }
  );

  // Get all active cascades
  fastify.get('/api/v10/exchange/liquidation-cascade/active', async () => {
    const active = cascadeService.getActiveCascades();
    
    return {
      ok: true,
      count: active.length,
      data: active,
    };
  });

  console.log('[S10.4] Cascade API routes registered: /api/v10/exchange/liquidation-cascade/*');
}

export default cascadeRoutes;
