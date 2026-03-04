/**
 * PHASE 1.1 — Real Data API Routes
 * =================================
 * 
 * Endpoints for live market data with source tracking.
 */

import { FastifyInstance } from 'fastify';
import * as realDataService from './realdata.service.js';
import { marketCache } from '../cache/market.cache.js';

export async function realDataRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/live/:symbol — Get live snapshot
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/live/:symbol',
    async (request) => {
      const { symbol } = request.params;
      
      const snapshot = await realDataService.fetchLiveData(symbol.toUpperCase());
      
      if (!snapshot) {
        return {
          ok: false,
          error: `Failed to fetch live data for ${symbol}`,
        };
      }
      
      const sufficiency = realDataService.isDataSufficient(snapshot.sourceMeta);
      
      return {
        ok: true,
        symbol: snapshot.symbol,
        price: snapshot.price,
        changes: {
          '5m': snapshot.priceChange5m,
          '1h': snapshot.priceChange1h,
        },
        volume24h: snapshot.volume24h,
        derivatives: {
          openInterest: snapshot.openInterest,
          oiChange: snapshot.oiChange,
          fundingRate: snapshot.fundingRate,
        },
        orderbook: snapshot.orderbook,
        sourceMeta: snapshot.sourceMeta,
        dataQuality: {
          sufficient: sufficiency.sufficient,
          degraded: sufficiency.degraded,
          reason: sufficiency.reason,
        },
        timestamp: snapshot.timestamp,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/live/batch — Get multiple symbols
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: { symbols: string[] } }>(
    '/api/v10/exchange/live/batch',
    async (request) => {
      const symbols = request.body?.symbols || ['BTCUSDT', 'ETHUSDT'];
      
      const snapshots = await realDataService.fetchLiveDataBatch(
        symbols.map(s => s.toUpperCase())
      );
      
      const results: any[] = [];
      for (const [symbol, snapshot] of snapshots) {
        const sufficiency = realDataService.isDataSufficient(snapshot.sourceMeta);
        results.push({
          symbol,
          price: snapshot.price,
          priceChange5m: snapshot.priceChange5m,
          volume24h: snapshot.volume24h,
          sourceMeta: snapshot.sourceMeta,
          dataQuality: {
            sufficient: sufficiency.sufficient,
            degraded: sufficiency.degraded,
          },
        });
      }
      
      return {
        ok: true,
        count: results.length,
        data: results,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/live/:symbol/health — Data health check
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { symbol: string } }>(
    '/api/v10/exchange/live/:symbol/health',
    async (request) => {
      const { symbol } = request.params;
      
      const health = await realDataService.getDataHealth(symbol.toUpperCase());
      
      return {
        ok: true,
        ...health,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/cache/status — Cache status
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/cache/status', async () => {
    const symbols = marketCache.getAllSymbols();
    
    const statuses = symbols.map(symbol => marketCache.getStatus(symbol));
    
    // Count by data mode
    const live = statuses.filter(s => s.dataMode === 'LIVE').length;
    const stale = statuses.filter(s => s.dataMode === 'STALE').length;
    const mock = statuses.filter(s => s.dataMode === 'MOCK').length;
    
    return {
      ok: true,
      summary: {
        totalSymbols: symbols.length,
        live,
        stale,
        mock,
      },
      symbols: statuses,
    };
  });
  
  console.log('[Phase 1.1] Real Data Routes registered');
}
