/**
 * S10 + X1-X2 — Exchange Provider Routes
 * 
 * API endpoints for:
 * - Real market data from exchanges  
 * - Provider health monitoring
 * - Admin controls
 * 
 * Updated to use new X1-X2 provider system
 */

import { FastifyInstance } from 'fastify';
import {
  listProviders,
  getProvider,
  updateProviderConfig,
  resetProviderHealth,
  getRegistryStats,
} from './provider.registry.js';
import { resolveProviderForSymbol } from './provider.selector.js';

export async function providerRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // HEALTH & STATUS (X1)
  // ─────────────────────────────────────────────────────────────
  
  /**
   * GET /health - Provider health status
   */
  fastify.get('/health', async () => {
    const providers = listProviders();
    const stats = getRegistryStats();
    
    return {
      ok: true,
      stats,
      providers: providers.map(p => ({
        id: p.provider.id,
        enabled: p.config.enabled,
        priority: p.config.priority,
        health: p.health,
      })),
    };
  });
  
  /**
   * GET /list - List all providers
   */
  fastify.get('/list', async () => {
    const providers = listProviders();
    
    return {
      ok: true,
      providers: providers.map(p => ({
        id: p.provider.id,
        enabled: p.config.enabled,
        priority: p.config.priority,
        health: p.health,
      })),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // MARKET DATA (X2 - Binance)
  // ─────────────────────────────────────────────────────────────
  
  /**
   * GET /ticker/:symbol - Live ticker
   */
  fastify.get<{ Params: { symbol: string } }>(
    '/ticker/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        const provider = await resolveProviderForSymbol(symbol);
        
        const orderBook = await provider.getOrderBook(symbol.toUpperCase(), 1);
        
        return {
          ok: true,
          provider: provider.id,
          data: {
            symbol: symbol.toUpperCase(),
            mid: orderBook.mid,
            bestBid: orderBook.bids[0]?.[0],
            bestAsk: orderBook.asks[0]?.[0],
            timestamp: orderBook.t,
          },
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /orderbook/:symbol - Order book
   */
  fastify.get<{ 
    Params: { symbol: string };
    Querystring: { depth?: string };
  }>(
    '/orderbook/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        const depth = parseInt(request.query.depth || '20');
        
        const provider = await resolveProviderForSymbol(symbol);
        const orderBook = await provider.getOrderBook(symbol.toUpperCase(), depth);
        
        return {
          ok: true,
          provider: provider.id,
          data: orderBook,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /trades/:symbol - Recent trades
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { limit?: string };
  }>(
    '/trades/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        const limit = parseInt(request.query.limit || '100');
        
        const provider = await resolveProviderForSymbol(symbol);
        const trades = await provider.getTrades(symbol.toUpperCase(), limit);
        
        return {
          ok: true,
          provider: provider.id,
          count: trades.length,
          data: trades,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /candles/:symbol - OHLCV candles
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { interval?: string; limit?: string };
  }>(
    '/candles/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        const interval = request.query.interval || '1m';
        const limit = parseInt(request.query.limit || '100');
        
        const provider = await resolveProviderForSymbol(symbol);
        const candles = await provider.getCandles(symbol.toUpperCase(), interval, limit);
        
        return {
          ok: true,
          provider: provider.id,
          count: candles.length,
          data: candles,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /openinterest/:symbol - Open Interest
   */
  fastify.get<{ Params: { symbol: string } }>(
    '/openinterest/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        
        const provider = await resolveProviderForSymbol(symbol);
        const oi = await provider.getOpenInterest(symbol.toUpperCase());
        
        return {
          ok: true,
          provider: provider.id,
          data: oi,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /funding/:symbol - Funding rate
   */
  fastify.get<{ Params: { symbol: string } }>(
    '/funding/:symbol',
    async (request) => {
      try {
        const { symbol } = request.params;
        
        const provider = await resolveProviderForSymbol(symbol);
        const funding = await provider.getFunding(symbol.toUpperCase());
        
        return {
          ok: true,
          provider: provider.id,
          data: funding,
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  /**
   * GET /symbols - Available symbols from primary provider
   */
  fastify.get('/symbols', async () => {
    try {
      const provider = await resolveProviderForSymbol('BTCUSDT');
      const symbols = await provider.getSymbols();
      
      return {
        ok: true,
        provider: provider.id,
        count: symbols.length,
        symbols: symbols.slice(0, 100),  // Limit response size
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // ADMIN CONTROLS (Y1)
  // ─────────────────────────────────────────────────────────────
  
  /**
   * POST /admin/enable - Enable a provider
   */
  fastify.post<{ Body: { id: string } }>(
    '/admin/enable',
    async (request) => {
      const { id } = request.body || {};
      if (!id) return { ok: false, error: 'Missing provider id' };
      
      const success = updateProviderConfig(id as any, { enabled: true });
      return { ok: success, message: success ? `${id} enabled` : 'Provider not found' };
    }
  );
  
  /**
   * POST /admin/disable - Disable a provider
   */
  fastify.post<{ Body: { id: string } }>(
    '/admin/disable',
    async (request) => {
      const { id } = request.body || {};
      if (!id) return { ok: false, error: 'Missing provider id' };
      
      const success = updateProviderConfig(id as any, { enabled: false });
      return { ok: success, message: success ? `${id} disabled` : 'Provider not found' };
    }
  );
  
  /**
   * POST /admin/reset - Reset circuit breaker
   */
  fastify.post<{ Body: { id: string } }>(
    '/admin/reset',
    async (request) => {
      const { id } = request.body || {};
      if (!id) return { ok: false, error: 'Missing provider id' };
      
      const success = resetProviderHealth(id as any);
      return { ok: success, message: success ? `${id} health reset` : 'Provider not found' };
    }
  );
  
  /**
   * POST /admin/priority - Update priority
   */
  fastify.post<{ Body: { id: string; priority: number } }>(
    '/admin/priority',
    async (request) => {
      const { id, priority } = request.body || {};
      if (!id || priority === undefined) return { ok: false, error: 'Missing id or priority' };
      
      const success = updateProviderConfig(id as any, { priority });
      return { ok: success, message: success ? `${id} priority updated to ${priority}` : 'Provider not found' };
    }
  );
  
  /**
   * POST /admin/test - Test provider connectivity
   */
  fastify.post<{ Body: { id: string } }>(
    '/admin/test',
    async (request) => {
      try {
        const { id } = request.body || {};
        if (!id) return { ok: false, error: 'Missing provider id' };
        
        const entry = getProvider(id as any);
        if (!entry) return { ok: false, error: 'Provider not found' };
        
        const health = await entry.provider.health();
        const symbols = await entry.provider.getSymbols();
        
        return {
          ok: true,
          health,
          symbolCount: symbols.length,
          sampleSymbols: symbols.slice(0, 5).map(s => s.symbol),
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    }
  );
  
  console.log('[X1-X2] Provider routes registered');
}

export default providerRoutes;
