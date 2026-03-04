/**
 * S10.4 — Liquidation Cascade Admin Routes
 * 
 * Diagnostic endpoints for admin panel.
 */

import { FastifyInstance } from 'fastify';
import * as cascadeService from './cascade.service.js';

export async function cascadeAdminRoutes(fastify: FastifyInstance): Promise<void> {
  // Get diagnostics for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/admin/exchange/liquidation-cascade/:symbol/diagnostics',
    async (request) => {
      const { symbol } = request.params;
      const diagnostics = cascadeService.getDiagnostics(symbol.toUpperCase());
      
      return {
        ok: true,
        data: diagnostics,
      };
    }
  );

  // Get all diagnostics
  fastify.get('/api/admin/exchange/liquidation-cascade/diagnostics', async () => {
    const symbols = cascadeService.getTrackedSymbols();
    const diagnostics = symbols.map(symbol => cascadeService.getDiagnostics(symbol));
    
    return {
      ok: true,
      count: diagnostics.length,
      data: diagnostics,
    };
  });

  // Clear caches
  fastify.post('/api/admin/exchange/liquidation-cascade/clear', async () => {
    cascadeService.clearCaches();
    
    return {
      ok: true,
      message: 'Cascade caches cleared',
    };
  });

  console.log('[S10.4] Cascade Admin routes registered: /api/admin/exchange/liquidation-cascade/*');
}

export default cascadeAdminRoutes;
