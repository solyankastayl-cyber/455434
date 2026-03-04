/**
 * FORECAST OUTCOMES ROUTES
 * ========================
 * 
 * V3.4: Outcome Tracking - API endpoints
 * 
 * GET /api/market/forecast-outcomes
 *   - Get outcomes for chart markers
 * 
 * GET /api/market/forecast-outcomes/stats
 *   - Get win/loss statistics
 */

import type { FastifyInstance } from 'fastify';
import type { Db } from 'mongodb';
import { getOutcomeTrackerService, type PriceProvider } from './outcome-tracker.service.js';
import type { ForecastLayer, ForecastHorizon } from './forecast-snapshot.types.js';

export async function registerForecastOutcomeRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    priceProvider: PriceProvider;
  }
) {
  const service = getOutcomeTrackerService(deps.db, deps.priceProvider);

  /**
   * GET /api/market/forecast-outcomes
   * 
   * Get outcome markers for chart display
   * 
   * Query params:
   *   symbol: string (default: BTC)
   *   layer: forecast | exchange | onchain | sentiment
   *   horizon: 1D | 7D | 30D
   *   limit: number (default: 30)
   */
  app.get<{
    Querystring: {
      symbol?: string;
      layer?: string;
      horizon?: string;
      limit?: string;
    };
  }>('/api/market/forecast-outcomes', async (request, reply) => {
    const {
      symbol = 'BTC',
      layer = 'forecast',
      horizon = '7D',
      limit = '30',
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const layerNorm = layer as ForecastLayer;
    const horizonNorm = horizon as ForecastHorizon;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

    // Validate layer
    const validLayers: ForecastLayer[] = ['forecast', 'exchange', 'onchain', 'sentiment'];
    if (!validLayers.includes(layerNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_LAYER',
        message: `Layer must be one of: ${validLayers.join(', ')}`,
      });
    }

    // Validate horizon
    const validHorizons: ForecastHorizon[] = ['1D', '7D', '30D'];
    if (!validHorizons.includes(horizonNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: ${validHorizons.join(', ')}`,
      });
    }

    try {
      const outcomes = await service.getOutcomesForChart(
        symbolNorm,
        layerNorm,
        horizonNorm,
        limitNum
      );

      return reply.send({
        ok: true,
        symbol: symbolNorm,
        layer: layerNorm,
        horizon: horizonNorm,
        outcomes,
        count: outcomes.length,
      });
    } catch (err: any) {
      app.log.error(`[ForecastOutcomes] Error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/market/forecast-outcomes/stats
   * 
   * Get statistics for a layer/horizon
   */
  app.get<{
    Querystring: {
      symbol?: string;
      layer?: string;
      horizon?: string;
    };
  }>('/api/market/forecast-outcomes/stats', async (request, reply) => {
    const {
      symbol = 'BTC',
      layer = 'forecast',
      horizon = '7D',
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const layerNorm = layer as ForecastLayer;
    const horizonNorm = horizon as ForecastHorizon;

    try {
      const stats = await service.getStats(symbolNorm, layerNorm, horizonNorm);

      return reply.send({
        ok: true,
        ...stats,
      });
    } catch (err: any) {
      app.log.error(`[ForecastOutcomes] Stats error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/market/forecast-outcomes/recent
   * 
   * Get recent outcome records (full details)
   */
  app.get<{
    Querystring: {
      symbol?: string;
      layer?: string;
      horizon?: string;
      limit?: string;
    };
  }>('/api/market/forecast-outcomes/recent', async (request, reply) => {
    const {
      symbol = 'BTC',
      layer = 'forecast',
      horizon = '7D',
      limit = '20',
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const layerNorm = layer as ForecastLayer;
    const horizonNorm = horizon as ForecastHorizon;
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 50);

    try {
      const outcomes = await service.getRecentOutcomes(
        symbolNorm,
        layerNorm,
        horizonNorm,
        limitNum
      );

      return reply.send({
        ok: true,
        symbol: symbolNorm,
        layer: layerNorm,
        horizon: horizonNorm,
        outcomes,
        count: outcomes.length,
      });
    } catch (err: any) {
      app.log.error(`[ForecastOutcomes] Recent error: ${err.message}`);
      return reply.status(500).send({
        ok: false,
        error: 'INTERNAL_ERROR',
        message: err.message,
      });
    }
  });

  app.log.info('[ForecastOutcomes] Routes registered (V3.4)');
}

console.log('[ForecastOutcomeRoutes] V3.4 Routes loaded');
