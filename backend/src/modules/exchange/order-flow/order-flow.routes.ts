/**
 * S10.2 — Order Flow API Routes
 * 
 * All routes are READ-ONLY, fast, no side effects.
 * These endpoints describe market behavior, not predictions.
 */

import { FastifyInstance } from 'fastify';
import * as orderFlowService from './order-flow.service.js';

export async function orderFlowRoutes(fastify: FastifyInstance): Promise<void> {
  // Get full order flow summary for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/order-flow/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const summary = orderFlowService.getOrderFlowSummary(symbol.toUpperCase());
      
      return {
        ok: true,
        data: summary,
      };
    }
  );

  // Get absorption state for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/absorption/:symbol',
    async (request) => {
      const { symbol } = request.params;
      orderFlowService.updateAbsorption(symbol.toUpperCase());
      const absorption = orderFlowService.getAbsorptionState(symbol.toUpperCase());
      
      if (!absorption) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No absorption data for ${symbol}`,
        };
      }
      
      return { ok: true, data: absorption };
    }
  );

  // Get imbalance pressure for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/pressure/:symbol',
    async (request) => {
      const { symbol } = request.params;
      orderFlowService.updatePressure(symbol.toUpperCase());
      const pressure = orderFlowService.getPressureState(symbol.toUpperCase());
      
      if (!pressure) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No pressure data for ${symbol}`,
        };
      }
      
      return { ok: true, data: pressure };
    }
  );

  // Get all symbols with order flow data
  fastify.get('/api/v10/exchange/order-flow', async () => {
    const symbols = orderFlowService.getTrackedSymbols();
    const summaries = symbols.map(symbol => orderFlowService.getOrderFlowSummary(symbol));
    
    return {
      ok: true,
      count: summaries.length,
      data: summaries,
    };
  });

  console.log('[S10.2] Order Flow API routes registered: /api/v10/exchange/order-flow/*');
}

export default orderFlowRoutes;
