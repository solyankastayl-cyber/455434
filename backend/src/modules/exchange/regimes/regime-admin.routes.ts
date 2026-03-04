/**
 * S10.3 — Regime Admin Routes
 * 
 * Diagnostic endpoints for admin panel.
 * Shows why regime was detected.
 */

import { FastifyInstance } from 'fastify';
import * as regimeService from './regime.service.js';

export async function regimeAdminRoutes(fastify: FastifyInstance): Promise<void> {
  // Get diagnostics for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/admin/exchange/regime/:symbol/diagnostics',
    async (request) => {
      const { symbol } = request.params;
      const diagnostics = regimeService.getDiagnostics(symbol.toUpperCase());
      
      return {
        ok: true,
        data: diagnostics,
      };
    }
  );

  // Get all diagnostics
  fastify.get('/api/admin/exchange/regime/diagnostics', async () => {
    const symbols = regimeService.getTrackedSymbols();
    const diagnostics = symbols.map(symbol => regimeService.getDiagnostics(symbol));
    
    return {
      ok: true,
      count: diagnostics.length,
      data: diagnostics,
    };
  });

  // Clear caches
  fastify.post('/api/admin/exchange/regime/clear', async () => {
    regimeService.clearCaches();
    
    return {
      ok: true,
      message: 'Regime caches cleared',
    };
  });

  console.log('[S10.3] Regime Admin routes registered: /api/admin/exchange/regime/*');
}

export default regimeAdminRoutes;
