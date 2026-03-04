/**
 * S10.1 — Exchange API Routes (v10)
 * 
 * All routes are READ-ONLY, fast, no side effects.
 */

import { FastifyInstance } from 'fastify';
import * as exchangeService from '../exchange-data.service.js';
import { listProviders, getRegistryStats } from '../providers/provider.registry.js';

export async function exchangeRoutes(fastify: FastifyInstance): Promise<void> {
  // Health endpoint (updated to show all providers)
  fastify.get('/api/v10/exchange/health', async () => {
    const legacyHealth = exchangeService.getHealth();
    const providers = listProviders();
    const stats = getRegistryStats();
    
    // Find primary working provider
    const workingProviders = providers
      .filter(p => p.config.enabled && p.health.status !== 'DOWN')
      .sort((a, b) => b.config.priority - a.config.priority);
    
    const primaryProvider = workingProviders[0];
    
    return {
      ...legacyHealth,
      // Override with actual status
      status: primaryProvider ? 'operational' : legacyHealth.status,
      activeProvider: primaryProvider ? {
        id: primaryProvider.provider.id,
        priority: primaryProvider.config.priority,
        status: primaryProvider.health.status,
      } : null,
      providers: providers.map(p => ({
        id: p.provider.id,
        priority: p.config.priority,
        enabled: p.config.enabled,
        status: p.health.status,
        errorCount: p.health.errorCount,
      })),
      providerStats: stats,
    };
  });

  // Overview endpoint (main dashboard data)
  fastify.get('/api/v10/exchange/overview', async () => {
    return {
      ok: true,
      data: exchangeService.getOverview(),
    };
  });

  // Markets list
  fastify.get('/api/v10/exchange/markets', async () => {
    return {
      ok: true,
      data: exchangeService.getMarkets(),
    };
  });

  // Order book for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/orderbook/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const data = exchangeService.getOrderBook(symbol.toUpperCase());
      
      if (!data) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No order book data for ${symbol}`,
        };
      }
      
      return { ok: true, data };
    }
  );

  // Trade flow for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/flow/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const data = exchangeService.getTradeFlow(symbol.toUpperCase());
      
      if (!data) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No trade flow data for ${symbol}`,
        };
      }
      
      return { ok: true, data };
    }
  );

  // Open interest for symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/oi/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const data = exchangeService.getOpenInterest(symbol.toUpperCase());
      
      if (!data) {
        return {
          ok: false,
          error: 'NOT_FOUND',
          message: `No OI data for ${symbol}`,
        };
      }
      
      return { ok: true, data };
    }
  );

  // Liquidations (optionally filtered by symbol)
  fastify.get<{ Querystring: { symbol?: string } }>(
    '/api/v10/exchange/liquidations',
    async (request) => {
      const { symbol } = request.query;
      const data = exchangeService.getLiquidations(symbol?.toUpperCase());
      
      return {
        ok: true,
        count: data.length,
        data,
      };
    }
  );

  // Liquidations for specific symbol
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/liquidations/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const data = exchangeService.getLiquidations(symbol.toUpperCase());
      
      return {
        ok: true,
        count: data.length,
        data,
      };
    }
  );

  console.log('[S10] Exchange API routes registered: /api/v10/exchange/*');
}

export default exchangeRoutes;
