/**
 * S10.6I — Indicator API Routes
 * 
 * REST API for indicator data.
 * Read-only, no signals, no decisions.
 */

import { FastifyInstance } from 'fastify';
import * as indicatorService from './indicator.service.js';
import { IndicatorCategory } from './indicator.types.js';

export async function indicatorRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/status — Registry status
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/indicators/status', async () => {
    const status = indicatorService.getRegistryStatus();
    
    return {
      ok: true,
      status,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/definitions — All definitions
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/indicators/definitions', async () => {
    const definitions = indicatorService.getAllDefinitions();
    
    return {
      ok: true,
      count: definitions.length,
      definitions,
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/definitions/:category
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { category: string } }>(
    '/api/v10/exchange/indicators/definitions/:category',
    async (request) => {
      const { category } = request.params;
      const validCategories: IndicatorCategory[] = [
        'PRICE_STRUCTURE', 'MOMENTUM', 'VOLUME', 'ORDER_BOOK', 'POSITIONING', 'WHALE_POSITIONING'
      ];
      
      if (!validCategories.includes(category.toUpperCase() as IndicatorCategory)) {
        return {
          ok: false,
          error: `Invalid category. Valid: ${validCategories.join(', ')}`,
        };
      }
      
      const definitions = indicatorService.getDefinitionsByCategory(
        category.toUpperCase() as IndicatorCategory
      );
      
      return {
        ok: true,
        category: category.toUpperCase(),
        count: definitions.length,
        definitions,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/:symbol — Full snapshot
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/indicators/:symbol',
    async (request) => {
      const { symbol } = request.params;
      const snapshot = indicatorService.getIndicatorSnapshot(symbol);
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        snapshot,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/:symbol/:category
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string; category: string } }>(
    '/api/v10/exchange/indicators/:symbol/:category',
    async (request) => {
      const { symbol, category } = request.params;
      const validCategories: IndicatorCategory[] = [
        'PRICE_STRUCTURE', 'MOMENTUM', 'VOLUME', 'ORDER_BOOK', 'POSITIONING', 'WHALE_POSITIONING'
      ];
      
      if (!validCategories.includes(category.toUpperCase() as IndicatorCategory)) {
        return {
          ok: false,
          error: `Invalid category. Valid: ${validCategories.join(', ')}`,
        };
      }
      
      const indicators = indicatorService.getIndicatorsByCategory(
        symbol,
        category.toUpperCase() as IndicatorCategory
      );
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        category: category.toUpperCase(),
        count: indicators.length,
        indicators,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/indicators/:symbol/single/:id
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string; id: string } }>(
    '/api/v10/exchange/indicators/:symbol/single/:id',
    async (request) => {
      const { symbol, id } = request.params;
      const indicator = indicatorService.getSingleIndicator(symbol, id);
      
      if (!indicator) {
        return {
          ok: false,
          error: `Indicator not found: ${id}`,
        };
      }
      
      return {
        ok: true,
        symbol: symbol.toUpperCase(),
        indicator,
      };
    }
  );

  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/indicators/batch — Multiple symbols
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbols: string[] } }>(
    '/api/v10/exchange/indicators/batch',
    async (request) => {
      const { symbols = [] } = request.body || {};
      
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return {
          ok: false,
          error: 'symbols array required',
        };
      }
      
      if (symbols.length > 10) {
        return {
          ok: false,
          error: 'Maximum 10 symbols per batch',
        };
      }
      
      const results = indicatorService.getIndicatorsForSymbols(symbols);
      
      return {
        ok: true,
        count: Object.keys(results).length,
        results,
      };
    }
  );

  console.log('[S10.6I] Indicator API routes registered: /api/v10/exchange/indicators/*');
}

// Admin routes
export async function indicatorAdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/admin/exchange/indicators/clear — Clear cache
  // ─────────────────────────────────────────────────────────────
  fastify.post('/api/admin/exchange/indicators/clear', async () => {
    indicatorService.clearCache();
    
    return {
      ok: true,
      message: 'Indicator cache cleared',
    };
  });

  // ─────────────────────────────────────────────────────────────
  // GET /api/admin/exchange/indicators/health — Service health
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/admin/exchange/indicators/health', async () => {
    const status = indicatorService.getRegistryStatus();
    
    return {
      ok: true,
      healthy: status.ready,
      status,
    };
  });

  console.log('[S10.6I] Indicator Admin routes registered: /api/admin/exchange/indicators/*');
}

export default indicatorRoutes;
