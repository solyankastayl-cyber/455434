/**
 * PHASE 1.3 — Chart Routes
 * =========================
 * 
 * API endpoints for market chart data with verdicts and divergences.
 * 
 * ENDPOINTS:
 *   GET /api/v10/market/chart/:symbol        - Full chart data
 *   GET /api/v10/market/chart/price/:symbol  - Price bars only
 *   GET /api/v10/market/chart/verdicts/:symbol - Verdict history only
 *   GET /api/v10/market/chart/divergences/:symbol - Divergences only
 */

import { FastifyInstance } from 'fastify';
import { ChartDataResponse } from './chart.types.js';
import { 
  getPriceHistory, 
  generateMockPriceHistory,
  getTimeframeMs,
} from './price.service.js';
import { 
  getVerdictHistory, 
  generateMockVerdictHistory,
} from './verdict-history.service.js';
import { 
  detectDivergences,
  calculateDivergenceStats,
} from './divergence.service.js';

export async function chartRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // FULL CHART DATA
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /chart/:symbol - Full chart data with price, verdicts, divergences
   * 
   * Query params:
   *   tf - timeframe (1h, 4h, 1d) default: 1h
   *   from - start time (unix ms)
   *   to - end time (unix ms)
   *   limit - max bars (default 200)
   *   horizon - divergence horizon bars (default 6)
   *   threshold - divergence threshold (default 0.02)
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      tf?: string;
      from?: string;
      to?: string;
      limit?: string;
      horizon?: string;
      threshold?: string;
    };
  }>('/chart/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = request.query.tf || '1h';
    const limit = parseInt(request.query.limit || '200');
    const to = parseInt(request.query.to || String(Date.now()));
    const from = parseInt(request.query.from || String(to - getTimeframeMs(tf) * limit));
    const horizon = parseInt(request.query.horizon || '6');
    const threshold = parseFloat(request.query.threshold || '0.02');
    
    // Fetch price data
    const priceResult = await getPriceHistory({
      symbol,
      timeframe: tf,
      from,
      to,
      limit,
    });
    
    let prices = priceResult.bars;
    let dataMode: 'LIVE' | 'MOCK' | 'CACHED' = priceResult.dataMode;
    
    // If no prices from provider, generate mock
    if (prices.length === 0) {
      prices = generateMockPriceHistory({ symbol, timeframe: tf, from, to });
      dataMode = 'MOCK';
    }
    
    // Fetch verdict history
    let verdicts = await getVerdictHistory({ symbol, from, to, limit: 500 });
    
    // If no verdicts from DB, generate mock
    if (verdicts.length === 0) {
      verdicts = generateMockVerdictHistory({
        symbol,
        from,
        to,
        intervalMs: getTimeframeMs(tf),
      });
    }
    
    // Detect divergences
    const divergences = detectDivergences(prices, verdicts, {
      horizonBars: horizon,
      threshold,
      minConfidence: 0.5,
    });
    
    // Calculate stats
    const stats = calculateDivergenceStats(verdicts, divergences);
    
    const response: ChartDataResponse = {
      symbol,
      timeframe: tf,
      window: { from, to },
      price: prices,
      verdicts,
      divergences,
      stats: {
        priceCount: prices.length,
        verdictCount: verdicts.length,
        divergenceCount: divergences.length,
        divergenceRate: stats.divergenceRate,
      },
      meta: {
        t0: new Date().toISOString(),
        provider: priceResult.provider,
        dataMode,
      },
    };
    
    return response;
  });
  
  // ═══════════════════════════════════════════════════════════════
  // PRICE ONLY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /chart/price/:symbol - Price bars only
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      tf?: string;
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/chart/price/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = request.query.tf || '1h';
    const limit = parseInt(request.query.limit || '200');
    const to = parseInt(request.query.to || String(Date.now()));
    const from = parseInt(request.query.from || String(to - getTimeframeMs(tf) * limit));
    
    const result = await getPriceHistory({ symbol, timeframe: tf, from, to, limit });
    
    let prices = result.bars;
    if (prices.length === 0) {
      prices = generateMockPriceHistory({ symbol, timeframe: tf, from, to });
    }
    
    return {
      ok: true,
      symbol,
      timeframe: tf,
      count: prices.length,
      prices,
      provider: result.provider,
      dataMode: prices.length === result.bars.length ? result.dataMode : 'MOCK',
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // VERDICTS ONLY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /chart/verdicts/:symbol - Verdict history only
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      from?: string;
      to?: string;
      limit?: string;
    };
  }>('/chart/verdicts/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const to = parseInt(request.query.to || String(Date.now()));
    const from = parseInt(request.query.from || String(to - 7 * 24 * 3600000));
    const limit = parseInt(request.query.limit || '500');
    
    let verdicts = await getVerdictHistory({ symbol, from, to, limit });
    
    if (verdicts.length === 0) {
      verdicts = generateMockVerdictHistory({
        symbol,
        from,
        to,
        intervalMs: 3600000,
      });
    }
    
    return {
      ok: true,
      symbol,
      count: verdicts.length,
      verdicts,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // DIVERGENCES ONLY
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /chart/divergences/:symbol - Divergences with stats
   */
  fastify.get<{
    Params: { symbol: string };
    Querystring: {
      tf?: string;
      from?: string;
      to?: string;
      horizon?: string;
      threshold?: string;
    };
  }>('/chart/divergences/:symbol', async (request, reply) => {
    const symbol = request.params.symbol.toUpperCase();
    const tf = request.query.tf || '1h';
    const to = parseInt(request.query.to || String(Date.now()));
    const from = parseInt(request.query.from || String(to - 7 * 24 * 3600000));
    const horizon = parseInt(request.query.horizon || '6');
    const threshold = parseFloat(request.query.threshold || '0.02');
    
    // Fetch price and verdicts
    const priceResult = await getPriceHistory({ symbol, timeframe: tf, from, to, limit: 500 });
    let prices = priceResult.bars;
    if (prices.length === 0) {
      prices = generateMockPriceHistory({ symbol, timeframe: tf, from, to });
    }
    
    let verdicts = await getVerdictHistory({ symbol, from, to, limit: 500 });
    if (verdicts.length === 0) {
      verdicts = generateMockVerdictHistory({ symbol, from, to, intervalMs: getTimeframeMs(tf) });
    }
    
    // Detect divergences
    const divergences = detectDivergences(prices, verdicts, {
      horizonBars: horizon,
      threshold,
      minConfidence: 0.5,
    });
    
    const stats = calculateDivergenceStats(verdicts, divergences);
    
    return {
      ok: true,
      symbol,
      config: { horizonBars: horizon, threshold },
      divergences,
      stats,
    };
  });
  
  console.log('[Phase 1.3] Chart Routes registered');
}

export default chartRoutes;
