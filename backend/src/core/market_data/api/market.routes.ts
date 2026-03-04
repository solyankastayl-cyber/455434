/**
 * Market Data API Routes (P1.5)
 * 
 * Read-only endpoints for market data.
 * NO trading endpoints. NO predictions.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getCandles,
  getLatestCandle,
  getCandleCount,
  getAvailableSymbols,
  CandleInterval,
  MarketSource
} from '../storage/market_candle.model.js';
import {
  getLatestMetric,
  getMetricsHistory,
  getRegimeDistribution
} from '../storage/market_metric.model.js';
import {
  getSourceHealthSummary,
  pauseSource,
  resumeSource
} from '../storage/market_source_state.model.js';
import { getAllQuality, getQualitySummary } from '../storage/market_quality.model.js';
import {
  syncSymbol,
  syncAllSymbols,
  backfillSymbol,
  getIngestionStatus
} from '../ingestion/index.js';
import {
  getMarketContext,
  getMarketRegimeSummary,
  refreshMetrics
} from '../aggregation/index.js';
import { getDefaultSymbols, getSupportedSymbols } from '../adapters/index.js';

// ============================================
// Routes
// ============================================

export async function marketRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ==========================================
  // Context & Metrics
  // ==========================================
  
  /**
   * GET /api/market/context/:symbol
   * Get full market context for a symbol
   */
  fastify.get<{ Params: { symbol: string } }>('/context/:symbol', async (request, reply) => {
    const context = await getMarketContext(request.params.symbol);
    
    if (!context) {
      return reply.status(404).send({ error: 'No market data for symbol' });
    }
    
    return context;
  });
  
  /**
   * GET /api/market/metrics/:symbol
   * Get metrics for a symbol
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { window?: string };
  }>('/metrics/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const window = (request.query.window || '24h') as '1h' | '24h' | '7d';
    
    const metric = await getLatestMetric(symbol, window);
    
    if (!metric) {
      return reply.status(404).send({ error: 'No metrics for symbol' });
    }
    
    return metric;
  });
  
  /**
   * GET /api/market/metrics/:symbol/history
   * Get metrics history
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: { window?: string; limit?: string };
  }>('/metrics/:symbol/history', async (request, reply) => {
    const { symbol } = request.params;
    const window = (request.query.window || '24h') as '1h' | '24h' | '7d';
    const limit = parseInt(request.query.limit || '24');
    
    const history = await getMetricsHistory(symbol, window, limit);
    
    return {
      symbol: symbol.toUpperCase(),
      window,
      count: history.length,
      metrics: history
    };
  });
  
  /**
   * GET /api/market/regime
   * Get market regime summary
   */
  fastify.get('/regime', async (request: FastifyRequest, reply: FastifyReply) => {
    const symbols = getDefaultSymbols();
    return getMarketRegimeSummary(symbols);
  });
  
  // ==========================================
  // Candles
  // ==========================================
  
  /**
   * GET /api/market/candles
   * Get candles for a symbol
   */
  fastify.get<{
    Querystring: {
      symbol: string;
      interval?: string;
      from?: string;
      to?: string;
      source?: string;
      limit?: string;
    };
  }>('/candles', async (request, reply) => {
    const { symbol, interval = '1h', from, to, source, limit = '100' } = request.query;
    
    if (!symbol) {
      return reply.status(400).send({ error: 'symbol required' });
    }
    
    const now = Date.now();
    const fromTs = from ? parseInt(from) : now - 24 * 60 * 60 * 1000;
    const toTs = to ? parseInt(to) : now;
    
    const candles = await getCandles(
      symbol,
      interval as CandleInterval,
      fromTs,
      toTs,
      source as MarketSource | undefined,
      parseInt(limit)
    );
    
    return {
      symbol: symbol.toUpperCase(),
      interval,
      count: candles.length,
      candles
    };
  });
  
  // ==========================================
  // Symbols
  // ==========================================
  
  /**
   * GET /api/market/symbols
   * Get configured/available symbols
   */
  fastify.get('/symbols', async (request: FastifyRequest, reply: FastifyReply) => {
    const [configured, available, supported] = await Promise.all([
      getDefaultSymbols(),
      getAvailableSymbols(),
      getSupportedSymbols('coingecko')
    ]);
    
    return {
      configured,
      available,
      supported
    };
  });
  
  // ==========================================
  // Quality & Health
  // ==========================================
  
  /**
   * GET /api/market/quality
   * Get data quality info
   */
  fastify.get('/quality', async (request: FastifyRequest, reply: FastifyReply) => {
    const [quality, summary] = await Promise.all([
      getAllQuality(),
      getQualitySummary()
    ]);
    
    return {
      summary,
      symbols: quality
    };
  });
  
  /**
   * GET /api/market/health
   * Health check
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    const [sourceHealth, qualitySummary, candleCount] = await Promise.all([
      getSourceHealthSummary(),
      getQualitySummary(),
      getCandleCount()
    ]);
    
    // Determine overall status
    const okSources = sourceHealth.byStatus['OK'] || 0;
    const totalSources = sourceHealth.total;
    const isHealthy = totalSources === 0 || (okSources / totalSources) >= 0.5;
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      module: 'Market Data (P1.5)',
      version: 'v1',
      sources: sourceHealth,
      quality: qualitySummary,
      candleCount
    };
  });
  
  /**
   * GET /api/market/stats
   * Get overall statistics
   */
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const [
      candleCount,
      symbols,
      sourceHealth,
      qualitySummary,
      ingestionStatus
    ] = await Promise.all([
      getCandleCount(),
      getAvailableSymbols(),
      getSourceHealthSummary(),
      getQualitySummary(),
      getIngestionStatus()
    ]);
    
    return {
      totalCandles: candleCount,
      symbolCount: symbols.length,
      sources: sourceHealth,
      quality: qualitySummary,
      ingestion: {
        enabledSources: ingestionStatus.enabledSources,
        configuredSymbols: ingestionStatus.configuredSymbols.length
      }
    };
  });
  
  // ==========================================
  // Admin (Sync/Backfill)
  // ==========================================
  
  /**
   * POST /api/market/sync/:symbol
   * Manually sync a symbol
   */
  fastify.post<{
    Params: { symbol: string };
    Querystring: { interval?: string };
  }>('/sync/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const interval = (request.query.interval || '1h') as CandleInterval;
    
    const result = await syncSymbol(symbol, interval);
    
    // Refresh metrics after sync
    if (!result.error) {
      await refreshMetrics(symbol, interval);
    }
    
    return result;
  });
  
  /**
   * POST /api/market/sync
   * Sync all configured symbols
   */
  fastify.post('/sync', async (request: FastifyRequest, reply: FastifyReply) => {
    const result = await syncAllSymbols(['1h']);
    return result;
  });
  
  /**
   * POST /api/market/backfill/:symbol
   * Backfill historical data
   */
  fastify.post<{
    Params: { symbol: string };
    Querystring: { days?: string; interval?: string };
  }>('/backfill/:symbol', async (request, reply) => {
    const { symbol } = request.params;
    const days = parseInt(request.query.days || '30');
    const interval = (request.query.interval || '1h') as CandleInterval;
    
    const result = await backfillSymbol(symbol, interval, days);
    
    // Refresh metrics after backfill
    if (!result.error) {
      await refreshMetrics(symbol, interval);
    }
    
    return result;
  });
  
  /**
   * POST /api/market/pause
   * Pause a source
   */
  fastify.post<{
    Querystring: { source: string; symbol?: string };
  }>('/pause', async (request, reply) => {
    const { source, symbol } = request.query;
    
    if (!source) {
      return reply.status(400).send({ error: 'source required' });
    }
    
    const count = await pauseSource(source as MarketSource, symbol);
    
    return { success: true, pausedCount: count };
  });
  
  /**
   * POST /api/market/resume
   * Resume a source
   */
  fastify.post<{
    Querystring: { source: string; symbol?: string };
  }>('/resume', async (request, reply) => {
    const { source, symbol } = request.query;
    
    if (!source) {
      return reply.status(400).send({ error: 'source required' });
    }
    
    const count = await resumeSource(source as MarketSource, symbol);
    
    return { success: true, resumedCount: count };
  });
  
  // ==========================================
  // Info
  // ==========================================
  
  /**
   * GET /api/market/info
   * Module info
   */
  fastify.get('/info', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      module: 'Market Data Layer',
      version: 'v1',
      phase: 'P2.1',
      description: 'Market context for ML features - NOT trading signals',
      
      principle: 'MARKET = context, not signal. Volumes serve as one feature among many.',
      
      sources: {
        primary: 'CoinGecko',
        secondary: ['Binance', 'CoinMarketCap (context)']
      },
      
      features: {
        candles: 'OHLCV data (1m, 5m, 1h, 4h, 1d)',
        metrics: 'Volatility, volume z-score, price change',
        regime: 'CALM / VOLATILE / STRESSED classification',
        quality: 'Coverage and freshness tracking'
      },
      
      mlFeatures: [
        'market_volumeDeltaZscore',
        'market_volatilityRegime',
        'market_liquidityRegime',
        'market_priceChangePercent24h',
        'market_volumeUsd24h'
      ],
      
      endpoints: {
        context: 'GET /api/market/context/:symbol',
        metrics: 'GET /api/market/metrics/:symbol',
        candles: 'GET /api/market/candles?symbol=ETH',
        quality: 'GET /api/market/quality',
        health: 'GET /api/market/health',
        sync: 'POST /api/market/sync/:symbol',
        backfill: 'POST /api/market/backfill/:symbol?days=30',
        testBinance: 'GET /api/market/test/binance?symbol=ETH'
      }
    };
  });
  
  // ==========================================
  // Test Endpoints (P2.1)
  // ==========================================
  
  /**
   * GET /api/market/test/binance
   * Test Binance adapter directly
   */
  fastify.get<{
    Querystring: { symbol?: string; interval?: string; limit?: string };
  }>('/test/binance', async (request, reply) => {
    const { symbol = 'ETH', interval = '1h', limit = '10' } = request.query;
    
    try {
      const { binanceAdapter } = await import('../adapters/binance.adapter.js');
      
      const startTime = Date.now();
      const result = await binanceAdapter.fetchCandles({
        symbol,
        interval: interval as CandleInterval,
        limit: parseInt(limit)
      });
      const latencyMs = Date.now() - startTime;
      
      return {
        ok: true,
        adapter: 'binance',
        symbol,
        interval,
        candleCount: result.candles.length,
        latencyMs,
        sample: result.candles.slice(0, 3).map(c => ({
          ts: c.ts,
          date: new Date(c.ts).toISOString(),
          o: c.o,
          h: c.h,
          l: c.l,
          c: c.c,
          v: c.v,
          trades: c.trades
        })),
        metadata: result.metadata
      };
      
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        adapter: 'binance',
        error: err.message || String(err)
      });
    }
  });
}
