/**
 * S10.3 — Regime API Routes
 * S10.6I.7 — Extended with Indicator-driven detection
 * 
 * Read-only endpoints for market regime detection.
 * NO signals, NO predictions — only structure.
 */

import { FastifyInstance } from 'fastify';
import * as regimeService from './regime.service.js';

export async function regimeRoutes(fastify: FastifyInstance): Promise<void> {
  // Get current regime for symbol (LEGACY)
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/regime/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const state = regimeService.getRegimeState(symbol.toUpperCase());
      
      if (!state) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No regime data for ${symbol}`,
        };
      }
      
      return { ok: true, data: state };
    }
  );

  // S10.6I.7 — Get indicator-driven regime for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/regime/:symbol/indicator-driven',
    async (request) => {
      const { symbol } = request.params;
      const result = regimeService.detectRegimeFromIndicators(symbol.toUpperCase());
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        data: result,
      };
    }
  );

  // S10.6I.7 — Get DUAL regime (legacy + indicator-driven)
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/regime/:symbol/dual',
    async (request) => {
      const { symbol } = request.params;
      const result = regimeService.detectRegimeDual(symbol.toUpperCase());
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        data: result,
      };
    }
  );

  // Get regime history for symbol
  fastify.get<{ Params: { symbol: string }; Querystring: { limit?: string } }>(
    '/api/v10/exchange/regime/history/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const limit = parseInt(request.query.limit || '20');
      const history = regimeService.getRegimeHistory(symbol.toUpperCase(), limit);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        count: history.length,
        data: history,
      };
    }
  );

  // Get all regimes
  fastify.get('/api/v10/exchange/regimes', async () => {
    const regimes = regimeService.getAllRegimes();
    
    return {
      ok: true,
      count: regimes.length,
      data: regimes,
    };
  });

  console.log('[S10.3] Regime API routes registered: /api/v10/exchange/regime/* (S10.6I.7 enabled)');
}

export default regimeRoutes;
