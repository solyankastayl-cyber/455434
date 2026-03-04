/**
 * БЛОК 1.3 — Funding Routes
 * ==========================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { fundingService } from './funding.service.js';

export async function registerFundingRoutes(app: FastifyInstance) {
  // Health check all venues
  app.get('/api/exchange/funding/health', async () => {
    const health = await fundingService.healthCheck();
    return { ok: true, venues: health };
  });

  // Get funding context for symbols
  app.get('/api/exchange/funding/context', async (req: FastifyRequest<{
    Querystring: { symbols?: string };
  }>) => {
    const symbolsStr = req.query.symbols ?? 'BTCUSDT,ETHUSDT';
    const symbols = symbolsStr.split(',').map(s => s.trim().toUpperCase());
    
    const contexts = await fundingService.getContext(symbols);
    
    return {
      ok: true,
      count: contexts.length,
      contexts,
    };
  });

  // Get single symbol context
  app.get('/api/exchange/funding/:symbol', async (req: FastifyRequest<{
    Params: { symbol: string };
  }>) => {
    const symbol = req.params.symbol.toUpperCase();
    const ctx = await fundingService.getContextOne(symbol);
    
    return {
      ok: ctx !== null,
      context: ctx,
    };
  });

  // Get timeline for symbol
  app.get('/api/exchange/funding/:symbol/timeline', async (req: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { limit?: string };
  }>) => {
    const symbol = req.params.symbol.toUpperCase();
    const limit = parseInt(req.query.limit ?? '100');
    
    const timeline = await fundingService.getTimeline(symbol, limit);
    
    return {
      ok: true,
      symbol,
      count: timeline.length,
      timeline,
    };
  });

  // Batch context for alt universe
  app.post('/api/exchange/funding/batch', async (req: FastifyRequest<{
    Body: { symbols: string[] };
  }>) => {
    const symbols = req.body.symbols.map(s => s.toUpperCase());
    const contexts = await fundingService.getContext(symbols);
    
    return {
      ok: true,
      count: contexts.length,
      contexts,
    };
  });

  console.log('[Funding] Routes registered');
}
