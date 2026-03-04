/**
 * FORECAST QUALITY ROUTES
 * =======================
 * 
 * V3.5: Model Quality Badge API
 * V3.6: Rolling Quality API
 * 
 * GET /api/market/forecast-quality
 * 
 * Query params:
 * - symbol: string (required)
 * - layer: forecast|exchange|onchain|sentiment (required)
 * - horizon: 1D|7D|30D (required)
 * - window: number (optional, default: 30)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from 'mongodb';
import { getForecastQualityService } from './forecast-quality.service.js';
import type { ForecastLayer, ForecastHorizon } from '../outcome-tracking/forecast-snapshot.types.js';

interface QualityQuery {
  symbol?: string;
  layer?: string;
  horizon?: string;
  window?: string;
}

export async function forecastQualityRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  const qualityService = getForecastQualityService(opts.db);

  fastify.get('/api/market/forecast-quality', async (
    request: FastifyRequest<{ Querystring: QualityQuery }>,
    reply: FastifyReply
  ) => {
    const { symbol, layer, horizon, window } = request.query;

    // Validate required params
    if (!symbol || !layer || !horizon) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'Required params: symbol, layer, horizon',
      });
    }

    // Validate layer
    const validLayers: ForecastLayer[] = ['forecast', 'exchange', 'onchain', 'sentiment'];
    if (!validLayers.includes(layer as ForecastLayer)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_LAYER',
        message: `Layer must be one of: ${validLayers.join(', ')}`,
      });
    }

    // Validate horizon
    const validHorizons: ForecastHorizon[] = ['1D', '7D', '30D'];
    if (!validHorizons.includes(horizon as ForecastHorizon)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: ${validHorizons.join(', ')}`,
      });
    }

    try {
      const result = await qualityService.getQuality({
        symbol,
        layer: layer as ForecastLayer,
        horizon: horizon as ForecastHorizon,
        window: window ? Number(window) : 30,
      });

      return reply.send({
        ok: true,
        data: result,
      });
    } catch (err: any) {
      fastify.log.error(err, '[ForecastQuality] Error getting quality');
      return reply.status(500).send({
        ok: false,
        error: 'QUALITY_ERROR',
        message: err.message,
      });
    }
  });
}

export function registerForecastQualityRoutes(fastify: FastifyInstance, opts: { db: Db }) {
  return forecastQualityRoutes(fastify, opts);
}

console.log('[ForecastQualityRoutes] V3.5 Quality API loaded');
