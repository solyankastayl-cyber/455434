/**
 * S10.2 — Order Flow Admin Routes
 * 
 * Diagnostic endpoints for admin panel
 */

import { FastifyInstance } from 'fastify';
import * as orderFlowService from './order-flow.service.js';

export async function orderFlowAdminRoutes(fastify: FastifyInstance): Promise<void> {
  // Get diagnostics for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/admin/exchange/order-flow/:symbol/diagnostics',
    async (request) => {
      const { symbol } = request.params;
      const diagnostics = orderFlowService.getDiagnostics(symbol.toUpperCase());
      
      return {
        ok: true,
        data: diagnostics,
      };
    }
  );

  // Get all diagnostics
  fastify.get('/api/admin/exchange/order-flow/diagnostics', async () => {
    const symbols = orderFlowService.getTrackedSymbols();
    const diagnostics = symbols.map(symbol => orderFlowService.getDiagnostics(symbol));
    
    return {
      ok: true,
      count: diagnostics.length,
      data: diagnostics,
    };
  });

  // Clear caches (admin action)
  fastify.post('/api/admin/exchange/order-flow/clear', async () => {
    orderFlowService.clearCaches();
    
    return {
      ok: true,
      message: 'Order flow caches cleared',
    };
  });

  console.log('[S10.2] Order Flow Admin routes registered: /api/admin/exchange/order-flow/*');
}

export default orderFlowAdminRoutes;
