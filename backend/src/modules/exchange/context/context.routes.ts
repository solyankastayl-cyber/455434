/**
 * B3 — Context Routes
 * 
 * API endpoints for Market Context.
 */

import { FastifyPluginAsync } from 'fastify';
import { buildMarketContext, buildContextBatch, getContext } from './context.builder.js';

export const contextRoutes: FastifyPluginAsync = async (fastify) => {
  // ─────────────────────────────────────────────────────────────
  // GET /context/:symbol — Get market context for symbol
  // ─────────────────────────────────────────────────────────────
  
  fastify.get<{
    Params: { symbol: string };
    Querystring: { rebuild?: string };
  }>('/context/:symbol', async (request, reply) => {
    try {
      const symbol = request.params.symbol.toUpperCase();
      const rebuild = request.query.rebuild === 'true';
      
      let context;
      
      if (rebuild) {
        context = await buildMarketContext(symbol);
      } else {
        context = await getContext(symbol);
        if (!context) {
          // Build if not cached
          context = await buildMarketContext(symbol);
        }
      }
      
      return { ok: true, context };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to get context',
        message: error.message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /context/batch — Build context for multiple symbols
  // ─────────────────────────────────────────────────────────────
  
  fastify.post<{
    Body: { symbols: string[] };
  }>('/context/batch', async (request, reply) => {
    try {
      const symbols = (request.body?.symbols ?? [])
        .map((s: string) => s.toUpperCase())
        .slice(0, 50);
      
      if (symbols.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'symbols_required',
        });
      }
      
      const contexts = await buildContextBatch(symbols);
      
      return {
        ok: true,
        count: contexts.length,
        contexts,
      };
    } catch (error: any) {
      return reply.status(500).send({
        ok: false,
        error: 'Failed to build contexts',
        message: error.message,
      });
    }
  });
};

console.log('[B3] Context Routes loaded');
