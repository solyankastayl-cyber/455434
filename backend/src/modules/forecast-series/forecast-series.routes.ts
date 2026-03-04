/**
 * FORECAST SERIES ROUTES
 * ======================
 * 
 * BLOCK F1: API Endpoints for Forecast Series
 * 
 * Public:
 *   GET /api/market/forecast-series - Get forecast candles
 * 
 * Admin:
 *   POST /api/admin/forecast-series/snapshot - Record snapshot manually
 *   GET /api/admin/forecast-series/stats - Get statistics
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Db } from 'mongodb';
import { getForecastSeriesRepo, ForecastSeriesRepo } from './forecast-series.repo.js';
import { getForecastSnapshotService, ForecastSnapshotService, VerdictLike } from './forecast-snapshot.service.js';
import { buildForecastCandles, buildForecastLine } from './forecast-candle.engine.js';
import type { 
  ForecastModelKey, 
  ForecastHorizon, 
  ForecastSeriesResponse 
} from './forecast-series.types.js';

// Valid models and horizons
const VALID_MODELS: ForecastModelKey[] = ['combined', 'exchange'];
const VALID_HORIZONS: ForecastHorizon[] = ['1D', '7D', '30D'];

type GetVerdictFn = (args: { symbol: string; horizon: ForecastHorizon }) => Promise<VerdictLike | null>;

export async function registerForecastSeriesRoutes(
  app: FastifyInstance, 
  deps: {
    db: Db;
    getVerdictV4: GetVerdictFn;
  }
) {
  const repo = getForecastSeriesRepo(deps.db);
  const snapshotService = getForecastSnapshotService(repo);
  
  // Ensure indexes on startup
  await repo.ensureIndexes();

  // ========================================
  // PUBLIC: Get forecast series
  // ========================================
  
  app.get<{
    Querystring: {
      symbol?: string;
      model?: string;
      horizon?: string;
      from?: string;
      to?: string;
      limit?: string;
      format?: string; // 'candles' | 'line'
    };
  }>('/api/market/forecast-series', async (request, reply) => {
    const { 
      symbol = 'BTC', 
      model = 'combined', 
      horizon = '1D',
      from,
      to,
      limit = '400',
      format = 'candles'
    } = request.query;

    const symbolNorm = symbol.toUpperCase();
    const modelNorm = model as ForecastModelKey;
    const horizonNorm = horizon as ForecastHorizon;

    // Validate model
    if (!VALID_MODELS.includes(modelNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_MODEL',
        message: `Model must be one of: ${VALID_MODELS.join(', ')}`,
      });
    }

    // Validate horizon
    if (!VALID_HORIZONS.includes(horizonNorm)) {
      return reply.status(400).send({
        ok: false,
        error: 'INVALID_HORIZON',
        message: `Horizon must be one of: ${VALID_HORIZONS.join(', ')}`,
      });
    }

    const points = await repo.listPoints({
      symbol: symbolNorm,
      model: modelNorm,
      horizon: horizonNorm,
      fromIso: from,
      toIso: to,
      limit: parseInt(limit, 10),
    });

    const response: ForecastSeriesResponse = {
      ok: true,
      symbol: symbolNorm,
      model: modelNorm,
      horizon: horizonNorm,
      points,
      candles: format === 'line' 
        ? [] // Line mode doesn't need candles
        : buildForecastCandles(points),
    };

    // Add line data if requested
    if (format === 'line') {
      (response as any).line = buildForecastLine(points);
    }

    return reply.send(response);
  });

  // ========================================
  // ADMIN: Manual snapshot
  // ========================================
  
  app.post<{
    Body: {
      symbol?: string;
      horizon?: string;
      models?: string[];
    };
  }>('/api/admin/forecast-series/snapshot', async (request, reply) => {
    const { 
      symbol = 'BTC', 
      horizon = '1D',
      models = ['combined', 'exchange']
    } = request.body || {};

    const symbolNorm = symbol.toUpperCase();
    const horizonNorm = horizon as ForecastHorizon;
    const modelsNorm = models.filter(m => VALID_MODELS.includes(m as ForecastModelKey)) as ForecastModelKey[];

    if (modelsNorm.length === 0) {
      return reply.status(400).send({
        ok: false,
        error: 'NO_VALID_MODELS',
        message: `No valid models provided. Use: ${VALID_MODELS.join(', ')}`,
      });
    }

    const results: Array<{ model: string; inserted: boolean; point?: any; error?: string }> = [];

    for (const model of modelsNorm) {
      try {
        // Get verdict from V4 engine
        const verdictRaw = await deps.getVerdictV4({ symbol: symbolNorm, horizon: horizonNorm });
        
        if (!verdictRaw) {
          results.push({ model, inserted: false, error: 'Verdict not available' });
          continue;
        }

        // Record point
        const { point, inserted } = await snapshotService.recordPoint({
          symbol: symbolNorm,
          model,
          horizon: horizonNorm,
          verdict: verdictRaw,
        });

        results.push({ model, inserted, point: inserted ? point : undefined });
      } catch (err: any) {
        results.push({ model, inserted: false, error: err.message });
      }
    }

    const recorded = results.filter(r => r.inserted).length;
    const skipped = results.filter(r => !r.inserted).length;

    return reply.send({
      ok: true,
      symbol: symbolNorm,
      horizon: horizonNorm,
      recorded,
      skipped,
      results,
    });
  });

  // ========================================
  // ADMIN: Statistics
  // ========================================
  
  app.get('/api/admin/forecast-series/stats', async (request, reply) => {
    const [total, symbols] = await Promise.all([
      repo.countPoints(),
      repo.getDistinctSymbols(),
    ]);

    // Get breakdown by model
    const byModel: Record<string, number> = {};
    for (const model of VALID_MODELS) {
      byModel[model] = await repo.countPoints({ model });
    }

    // Get breakdown by horizon
    const byHorizon: Record<string, number> = {};
    for (const horizon of VALID_HORIZONS) {
      byHorizon[horizon] = await repo.countPoints({ horizon });
    }

    return reply.send({
      ok: true,
      stats: {
        total,
        symbols: symbols.length,
        symbolList: symbols,
        byModel,
        byHorizon,
      },
    });
  });

  // ========================================
  // ADMIN: Get latest point
  // ========================================
  
  app.get<{
    Querystring: {
      symbol?: string;
      model?: string;
      horizon?: string;
    };
  }>('/api/admin/forecast-series/latest', async (request, reply) => {
    const { 
      symbol = 'BTC', 
      model = 'combined', 
      horizon = '1D' 
    } = request.query;

    const point = await repo.latestPoint({
      symbol: symbol.toUpperCase(),
      model: model as ForecastModelKey,
      horizon: horizon as ForecastHorizon,
    });

    if (!point) {
      return reply.status(404).send({
        ok: false,
        error: 'NOT_FOUND',
        message: 'No forecast point found for these parameters',
      });
    }

    return reply.send({
      ok: true,
      point,
    });
  });

  app.log.info('[ForecastSeries] Routes registered (Block F1)');
}

console.log('[ForecastSeriesRoutes] Module loaded (Block F1)');
