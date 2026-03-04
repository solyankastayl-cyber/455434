/**
 * Forecast Segments API Routes (BLOCK 4.3)
 * 
 * Public and admin endpoints for forecast segments.
 * 
 * PUBLIC (for UI):
 * - GET /api/market/forecast-segments - Get segments with ACTIVE + GHOST for graph
 * 
 * ADMIN:
 * - POST /api/admin/forecast-segments/rollover - Force rollover
 * - GET /api/admin/forecast-segments/stats - Statistics
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { getForecastSegmentRepo } from './forecast_segment.repo.js';
import {
  getSegmentRolloverService,
  initializeSegmentRolloverService,
  VerdictCandidate,
} from './segment_rollover.service.js';
import {
  SegmentLayer,
  SegmentHorizon,
  RolloverReason,
} from './forecast_segment.model.js';
import { getExchangeSnapshotService } from '../snapshots/exchange_snapshot.service.js';

// ═══════════════════════════════════════════════════════════════
// VERDICT PROVIDER (connects to Exchange ML)
// ═══════════════════════════════════════════════════════════════

async function getVerdictFromExchangeML(
  db: any,
  params: { symbol: string; layer: SegmentLayer; horizon: SegmentHorizon }
): Promise<VerdictCandidate | null> {
  const { symbol, layer, horizon } = params;
  
  // Only exchange layer uses Exchange ML
  if (layer !== 'exchange') {
    // For other layers, return placeholder (or integrate with their respective ML modules)
    return null;
  }
  
  try {
    // Get active snapshot from Exchange ML
    const snapshotService = getExchangeSnapshotService(db);
    const activeSnapshot = await snapshotService.getActive(symbol, horizon as any);
    
    if (!activeSnapshot) {
      console.log(`[VerdictProvider] No active snapshot for ${symbol} ${horizon}`);
      return null;
    }
    
    // Calculate target price based on prediction
    const currentPrice = activeSnapshot.entryPrice;
    const predictedWin = activeSnapshot.predictedClass === 'WIN';
    const confidence = activeSnapshot.confidence;
    
    // Target move based on horizon
    const baseMoveByHorizon: Record<string, number> = {
      '1D': 0.02,   // 2% base for 1D
      '7D': 0.05,   // 5% base for 7D
      '30D': 0.10,  // 10% base for 30D
    };
    
    const baseMove = baseMoveByHorizon[horizon] || 0.05;
    const adjustedMove = baseMove * confidence;
    const moveDirection = predictedWin ? 1 : -1;
    const targetPrice = currentPrice * (1 + moveDirection * adjustedMove);
    
    return {
      symbol,
      layer,
      horizon,
      anchorPrice: currentPrice,
      targetPrice,
      expectedReturnPct: moveDirection * adjustedMove * 100,
      confidence,
      meta: {
        modelVersion: String(activeSnapshot.modelVersion),
        snapshotId: activeSnapshot.snapshotId,
        source: 'exchange-ml-snapshot',
      },
    };
  } catch (err) {
    console.error('[VerdictProvider] Error getting verdict:', err);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════

export async function forecastSegmentPublicRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  const repo = getForecastSegmentRepo(db);
  
  // Initialize rollover service with verdict provider
  initializeSegmentRolloverService(db, (params) => getVerdictFromExchangeML(db, params));
  
  /**
   * GET /api/market/forecast-segments
   * Get segments for UI graph rendering.
   */
  fastify.get('/api/market/forecast-segments', async (request, _reply) => {
    const query = request.query as {
      symbol?: string;
      layer?: string;
      horizon?: string;
      includeGhost?: string;
    };
    
    const symbol = (query.symbol || 'BTC').toUpperCase();
    const layer = (query.layer || 'exchange').toLowerCase() as SegmentLayer;
    const horizon = (query.horizon || '30D').toUpperCase() as SegmentHorizon;
    const includeGhost = query.includeGhost !== '0';
    
    const validLayers = ['forecast', 'exchange', 'onchain', 'sentiment'];
    const validHorizons = ['1D', '7D', '30D'];
    
    if (!validLayers.includes(layer)) {
      return { ok: false, error: 'INVALID_LAYER', message: `layer must be one of: ${validLayers.join(', ')}` };
    }
    
    if (!validHorizons.includes(horizon)) {
      return { ok: false, error: 'INVALID_HORIZON', message: `horizon must be one of: ${validHorizons.join(', ')}` };
    }
    
    // Ensure segment is up-to-date (handles rollover if needed)
    try {
      const rolloverService = getSegmentRolloverService(db);
      await rolloverService.ensureSegmentUpToDate({ symbol, layer, horizon });
    } catch (err) {
      console.error('[ForecastSegments] Rollover check failed:', err);
      // Continue - will return existing segments
    }
    
    // Get segments
    const segments = await repo.list({
      symbol,
      layer,
      horizon,
      limit: includeGhost ? 25 : 1,
    });
    
    const filtered = includeGhost ? segments : segments.filter(s => s.status === 'ACTIVE');
    
    // Transform for UI
    const result = filtered.map(s => ({
      segmentId: s.segmentId,
      status: s.status,
      startTs: s.startTs,
      endTs: s.endTs,
      fromPrice: s.fromPrice,
      targetPrice: s.targetPrice,
      expectedMovePct: s.expectedMovePct,
      candles: s.candles,
      meta: s.meta ?? null,
      reason: s.reason ?? null,
      createdAt: s.createdAt,
    }));
    
    // Get rollover info for UI
    const active = filtered.find(s => s.status === 'ACTIVE');
    const lastGhost = filtered.find(s => s.status === 'GHOST');
    
    return {
      ok: true,
      data: {
        symbol,
        layer,
        horizon,
        segments: result,
        rolloverInfo: {
          activeStart: active?.startTs ?? null,
          prevStart: lastGhost?.startTs ?? null,
          nextRollover: active ? active.startTs + 7 * 24 * 60 * 60 : null,
        },
      },
    };
  });
  
  console.log('[ForecastSegments] Public routes registered');
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

export async function forecastSegmentAdminRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  const repo = getForecastSegmentRepo(db);
  
  /**
   * GET /api/admin/forecast-segments/stats
   * Get segment statistics.
   */
  fastify.get('/api/admin/forecast-segments/stats', async (_request, _reply) => {
    const stats = await repo.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * POST /api/admin/forecast-segments/rollover
   * Force segment rollover.
   */
  fastify.post('/api/admin/forecast-segments/rollover', async (request, _reply) => {
    const body = request.body as {
      symbol?: string;
      layer?: string;
      horizon?: string;
      reason?: string;
    };
    
    const symbol = (body.symbol || 'BTC').toUpperCase();
    const layer = (body.layer || 'exchange').toLowerCase() as SegmentLayer;
    const horizon = (body.horizon || '30D').toUpperCase() as SegmentHorizon;
    const reason = (body.reason || 'MANUAL') as RolloverReason;
    
    try {
      const rolloverService = getSegmentRolloverService(db);
      const result = await rolloverService.forceRollover({
        symbol,
        layer,
        horizon,
        reason,
      });
      
      return {
        ok: true,
        data: {
          changed: result.changed,
          newSegmentId: result.active?.segmentId,
          ghostedSegmentId: result.ghosted?.segmentId,
          reason: result.reason,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'ROLLOVER_FAILED',
        message: err.message,
      };
    }
  });
  
  /**
   * POST /api/admin/forecast-segments/init
   * Initialize indexes.
   */
  fastify.post('/api/admin/forecast-segments/init', async (_request, _reply) => {
    await repo.ensureIndexes();
    
    return {
      ok: true,
      data: { message: 'Forecast segment indexes ensured' },
    };
  });
  
  /**
   * GET /api/admin/forecast-segments/:segmentId
   * Get segment details.
   */
  fastify.get('/api/admin/forecast-segments/:segmentId', async (request, _reply) => {
    const params = request.params as { segmentId: string };
    
    const segment = await repo.getById(params.segmentId);
    
    if (!segment) {
      return { ok: false, error: 'NOT_FOUND', message: 'Segment not found' };
    }
    
    return { ok: true, data: segment };
  });
  
  console.log('[ForecastSegments] Admin routes registered');
}

export default { forecastSegmentPublicRoutes, forecastSegmentAdminRoutes };
