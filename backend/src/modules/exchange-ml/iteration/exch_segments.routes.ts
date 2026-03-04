/**
 * BLOCK 5.4 — Exchange Segments Routes
 * =====================================
 * 
 * Real segment-based forecast API (replaces synthetic bridge).
 * 
 * Endpoints:
 * - GET /api/exchange/segments       - List all segments (ACTIVE + SUPERSEDED)
 * - POST /api/admin/exchange/segments/roll - Manual segment roll (testing)
 * - GET /api/exchange/segment-candles     - Candles for specific segment
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Db } from 'mongodb';
import { getDb } from '../../../db/mongodb.js';
import { getExchForecastSegmentService, CreateSegmentArgs, RollReason } from './exch_forecast_segment.service.js';
import { getExchForecastSegmentRepo } from './exch_forecast_segment.repo.js';
import { ExchHorizon, ExchDriftState } from './exch_forecast_segment.model.js';
import { buildAdaptiveTrajectory, daySeedUTC } from '../../forecast-series/adaptive-trajectory.engine.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

type ExchangeForecastProvider = (args: {
  asset: string;
  horizon: ExchHorizon;
}) => Promise<{
  modelVersion: string;
  entryPrice: number;
  targetPrice: number;
  expectedReturn: number;
  confidence: number;
  biasApplied: number;
  driftState: ExchDriftState;
} | null>;

const VALID_HORIZONS = new Set(['1D', '7D', '30D']);

// ═══════════════════════════════════════════════════════════════
// CANDLE GENERATION
// ═══════════════════════════════════════════════════════════════

function generateSegmentCandles(params: {
  entryPrice: number;
  targetPrice: number;
  horizon: ExchHorizon;
  createdAt: Date;
  supersededAt?: Date | null;
  confidence: number;
  biasApplied: number;
  driftState: ExchDriftState;
  segmentId: string;
}): Array<{ time: number; open: number; high: number; low: number; close: number }> {
  const { entryPrice, targetPrice, horizon, createdAt, supersededAt, confidence, biasApplied, driftState, segmentId } = params;

  // Determine steps based on horizon
  const horizonDays = horizon === '1D' ? 2 : horizon === '7D' ? 8 : 31;
  
  // If superseded, calculate actual duration
  let actualSteps = horizonDays;
  if (supersededAt) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const durationDays = Math.ceil((supersededAt.getTime() - createdAt.getTime()) / msPerDay);
    actualSteps = Math.max(2, Math.min(durationDays + 1, horizonDays));
  }

  // Generate seed from segment ID for determinism
  const seedBase = segmentId.split('_').pop() || '0';
  const seed = parseInt(seedBase.replace(/[^0-9]/g, '').slice(0, 8) || '12345', 10);

  // Map drift state
  const driftMap: Record<string, 'HEALTHY' | 'DEGRADING' | 'CRITICAL'> = {
    'NORMAL': 'HEALTHY',
    'WARNING': 'DEGRADING',
    'CRITICAL': 'CRITICAL',
  };

  // Build trajectory using V3.11 adaptive engine
  const result = buildAdaptiveTrajectory({
    startPrice: entryPrice,
    targetPrice: targetPrice,
    steps: actualSteps,
    volDaily: 0.8,
    confidence,
    quality: confidence > 0.6 ? 'GOOD' : confidence > 0.4 ? 'NEUTRAL' : 'WEAK',
    drift: driftMap[driftState] || 'HEALTHY',
    health: 'HEALTHY',
    bias7d: biasApplied,
    seed,
  });

  // Add timestamps to candles
  const startTs = Math.floor(createdAt.getTime() / 1000);
  const daySeconds = 24 * 60 * 60;

  return result.candles.map((c, i) => ({
    time: startTs + i * daySeconds,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════

export async function exchSegmentsPublicRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  const repo = getExchForecastSegmentRepo(db);

  /**
   * GET /api/exchange/segments
   * List segments for UI timeline rendering.
   * 
   * Query params:
   * - asset: BTC, ETH, etc (default: BTC)
   * - horizon: 1D, 7D, 30D (default: 30D)
   * - limit: max segments to return (default: 50)
   */
  fastify.get('/api/exchange/segments', async (request, _reply) => {
    const query = request.query as {
      asset?: string;
      horizon?: string;
      limit?: string;
    };

    const asset = (query.asset || 'BTC').toUpperCase();
    const horizon = (query.horizon || '30D').toUpperCase();
    const limit = Math.min(200, Math.max(1, parseInt(query.limit || '50', 10)));

    if (!VALID_HORIZONS.has(horizon)) {
      return { ok: false, error: 'INVALID_HORIZON', message: 'horizon must be 1D, 7D, or 30D' };
    }

    try {
      const segments = await repo.list(asset, horizon as ExchHorizon, limit);

      // Sort chronologically (oldest first) for timeline rendering
      const sorted = [...segments].sort((a, b) => 
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );

      // Transform for UI
      const items = sorted.map(s => ({
        segmentId: s.segmentId,
        modelVersion: s.modelVersion,
        createdAt: s.createdAt,
        supersededAt: s.supersededAt ?? null,
        resolvedAt: s.resolvedAt ?? null,
        entryPrice: s.entryPrice,
        targetPrice: s.targetPrice,
        expectedReturn: s.expectedReturn,
        confidence: s.confidence,
        biasApplied: s.biasApplied,
        driftState: s.driftState,
        status: s.status,
        rollReason: s.rollReason ?? null,
        outcome: s.outcome ?? null,
        actualReturn: s.actualReturn ?? null,
      }));

      return {
        ok: true,
        data: {
          asset,
          horizon,
          items,
          stats: {
            total: items.length,
            active: items.filter(s => s.status === 'ACTIVE').length,
            superseded: items.filter(s => s.status === 'SUPERSEDED').length,
            resolved: items.filter(s => s.status === 'RESOLVED').length,
          },
        },
      };
    } catch (err: any) {
      console.error('[ExchSegments] List error:', err);
      return { ok: false, error: 'LIST_FAILED', message: err.message };
    }
  });

  /**
   * GET /api/exchange/segment-candles
   * Generate candles for a specific segment.
   * 
   * Uses V3.11 Adaptive Trajectory Engine.
   */
  fastify.get('/api/exchange/segment-candles', async (request, _reply) => {
    const query = request.query as { segmentId?: string };
    const segmentId = query.segmentId || '';

    if (!segmentId) {
      return { ok: false, error: 'MISSING_SEGMENT_ID', message: 'segmentId is required' };
    }

    try {
      const segment = await repo.findBySegmentId(segmentId);

      if (!segment) {
        return { ok: false, error: 'SEGMENT_NOT_FOUND', message: 'Segment not found' };
      }

      // Generate candles using adaptive trajectory
      const candles = generateSegmentCandles({
        entryPrice: segment.entryPrice,
        targetPrice: segment.targetPrice,
        horizon: segment.horizon,
        createdAt: new Date(segment.createdAt),
        supersededAt: segment.supersededAt ? new Date(segment.supersededAt) : null,
        confidence: segment.confidence,
        biasApplied: segment.biasApplied,
        driftState: segment.driftState,
        segmentId: segment.segmentId,
      });

      return {
        ok: true,
        data: {
          segmentId: segment.segmentId,
          asset: segment.asset,
          horizon: segment.horizon,
          status: segment.status,
          entryPrice: segment.entryPrice,
          targetPrice: segment.targetPrice,
          candles,
          meta: {
            modelVersion: segment.modelVersion,
            confidence: segment.confidence,
            biasApplied: segment.biasApplied,
            driftState: segment.driftState,
            createdAt: segment.createdAt,
            supersededAt: segment.supersededAt,
          },
        },
      };
    } catch (err: any) {
      console.error('[ExchSegments] Candles error:', err);
      return { ok: false, error: 'CANDLES_FAILED', message: err.message };
    }
  });

  console.log('[ExchSegments] Public routes registered (/api/exchange/segments, /api/exchange/segment-candles)');
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

export async function exchSegmentsAdminRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & {
    getExchangeForecast?: ExchangeForecastProvider;
  }
): Promise<void> {
  const db = getDb();
  const service = getExchForecastSegmentService(db);
  const repo = getExchForecastSegmentRepo(db);

  // Default forecast provider (mock for testing)
  const getExchangeForecast: ExchangeForecastProvider = opts.getExchangeForecast || (async ({ asset, horizon }) => {
    // Try to get from real exchange ML if available
    try {
      const { heavyComputeService } = await import('../../verdict/runtime/heavy-compute.service.js');
      const payload = await heavyComputeService.compute(asset, horizon);
      
      if (payload?.verdict) {
        const entryPrice = payload.layers?.snapshot?.price || 100000;
        const expectedReturn = payload.verdict.expectedReturn || 0.05;
        
        return {
          modelVersion: `exchange_v4.${Date.now() % 1000}`,
          entryPrice,
          targetPrice: entryPrice * (1 + expectedReturn),
          expectedReturn,
          confidence: payload.verdict.confidenceAdjusted || payload.verdict.confidence || 0.5,
          biasApplied: payload.crossHorizonBias?.applied || 0,
          driftState: (payload.drift?.state as ExchDriftState) || 'NORMAL',
        };
      }
    } catch (e) {
      // Fallback to mock
    }

    // Mock data for testing
    const basePrice = asset === 'BTC' ? 98000 : asset === 'ETH' ? 3500 : 100;
    const expectedReturn = 0.05 + Math.random() * 0.05;
    
    return {
      modelVersion: `exchange_v4.${Date.now() % 1000}`,
      entryPrice: basePrice,
      targetPrice: basePrice * (1 + expectedReturn),
      expectedReturn,
      confidence: 0.5 + Math.random() * 0.3,
      biasApplied: (Math.random() - 0.5) * 0.2,
      driftState: 'NORMAL',
    };
  });

  /**
   * POST /api/admin/exchange/segments/roll
   * Manually trigger segment roll for testing.
   */
  fastify.post('/api/admin/exchange/segments/roll', async (request, _reply) => {
    const body = request.body as {
      asset?: string;
      horizon?: string;
      reason?: string;
    };

    const asset = (body.asset || 'BTC').toUpperCase();
    const horizon = (body.horizon || '30D').toUpperCase();
    const reason = (body.reason || 'MANUAL') as RollReason;

    if (!VALID_HORIZONS.has(horizon)) {
      return { ok: false, error: 'INVALID_HORIZON', message: 'horizon must be 1D, 7D, or 30D' };
    }

    try {
      // Get forecast data
      const forecast = await getExchangeForecast({ asset, horizon: horizon as ExchHorizon });

      if (!forecast) {
        return { ok: false, error: 'NO_FORECAST', message: 'Could not get forecast data' };
      }

      // Roll segment
      const result = await service.maybeRollSegment({
        asset,
        horizon: horizon as ExchHorizon,
        modelVersion: forecast.modelVersion,
        entryPrice: forecast.entryPrice,
        targetPrice: forecast.targetPrice,
        expectedReturn: forecast.expectedReturn,
        confidence: forecast.confidence,
        biasApplied: forecast.biasApplied,
        driftState: forecast.driftState,
        reason,
      });

      // Strip MongoDB _id from segment response
      const segmentClean = result.active ? {
        segmentId: result.active.segmentId,
        asset: result.active.asset,
        horizon: result.active.horizon,
        modelVersion: result.active.modelVersion,
        createdAt: result.active.createdAt,
        supersededAt: result.active.supersededAt,
        resolvedAt: result.active.resolvedAt,
        entryPrice: result.active.entryPrice,
        targetPrice: result.active.targetPrice,
        expectedReturn: result.active.expectedReturn,
        confidence: result.active.confidence,
        biasApplied: result.active.biasApplied,
        driftState: result.active.driftState,
        status: result.active.status,
        rollReason: result.active.rollReason,
      } : null;

      return {
        ok: true,
        data: {
          rolled: result.rolled,
          segmentId: result.active?.segmentId,
          reason: result.reason,
          supersededCount: result.supersededCount,
          segment: segmentClean,
        },
      };
    } catch (err: any) {
      console.error('[ExchSegments] Roll error:', err);
      return { ok: false, error: 'ROLL_FAILED', message: err.message };
    }
  });

  /**
   * GET /api/admin/exchange/segments/stats
   * Get segment statistics.
   */
  fastify.get('/api/admin/exchange/segments/stats', async (_request, _reply) => {
    try {
      const stats = await repo.getStats();
      return { ok: true, data: stats };
    } catch (err: any) {
      return { ok: false, error: 'STATS_FAILED', message: err.message };
    }
  });

  /**
   * POST /api/admin/exchange/segments/init
   * Initialize indexes.
   */
  fastify.post('/api/admin/exchange/segments/init', async (_request, _reply) => {
    try {
      await service.ensureIndexes();
      return { ok: true, data: { message: 'Indexes ensured' } };
    } catch (err: any) {
      return { ok: false, error: 'INIT_FAILED', message: err.message };
    }
  });

  /**
   * GET /api/admin/exchange/segments/:segmentId
   * Get segment details.
   */
  fastify.get('/api/admin/exchange/segments/:segmentId', async (request, _reply) => {
    const params = request.params as { segmentId: string };
    
    try {
      const segment = await service.getBySegmentId(params.segmentId);
      
      if (!segment) {
        return { ok: false, error: 'NOT_FOUND', message: 'Segment not found' };
      }

      // Strip MongoDB _id
      const { _id, ...cleanSegment } = segment as any;
      return { ok: true, data: cleanSegment };
    } catch (err: any) {
      return { ok: false, error: 'GET_FAILED', message: err.message };
    }
  });

  console.log('[ExchSegments] Admin routes registered (/api/admin/exchange/segments/*)');
}

export default { exchSegmentsPublicRoutes, exchSegmentsAdminRoutes };
