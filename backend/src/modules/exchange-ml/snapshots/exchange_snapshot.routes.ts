/**
 * Exchange Snapshot API Routes (BLOCK 1)
 * 
 * Public and admin endpoints for prediction snapshots.
 * 
 * PUBLIC (for UI):
 * - GET /api/market/exchange/snapshots - Get snapshot history
 * - GET /api/market/exchange/snapshots/active - Get active snapshots
 * 
 * ADMIN:
 * - GET /api/admin/exchange-ml/snapshots/stats - Snapshot statistics
 * - POST /api/admin/exchange-ml/snapshots/init - Initialize indexes
 * - POST /api/admin/exchange-ml/snapshots/create - Manually create snapshot
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getDb } from '../../../db/mongodb.js';
import { getExchangeSnapshotService } from './exchange_snapshot.service.js';
import { ExchangeHorizon } from '../dataset/exchange_dataset.types.js';
import { SnapshotStatus } from './exchange_prediction_snapshot.model.js';

// ═══════════════════════════════════════════════════════════════
// PUBLIC ROUTES (Market API)
// ═══════════════════════════════════════════════════════════════

export async function exchangeSnapshotPublicRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  
  /**
   * GET /api/market/exchange/snapshots
   * Get prediction snapshot history for UI timeline/graph.
   */
  fastify.get('/api/market/exchange/snapshots', async (request, _reply) => {
    const query = request.query as {
      symbol?: string;
      horizon?: ExchangeHorizon;
      status?: SnapshotStatus;
      limit?: string;
    };
    
    const snapshotService = getExchangeSnapshotService(db);
    
    // If symbol provided, get timeline for that symbol
    if (query.symbol && query.horizon) {
      const timeline = await snapshotService.getTimeline(
        query.symbol,
        query.horizon,
        parseInt(query.limit || '50', 10)
      );
      
      return {
        ok: true,
        data: {
          timeline,
          count: timeline.length,
          symbol: query.symbol,
          horizon: query.horizon,
        },
      };
    }
    
    // Otherwise, get by horizon
    if (!query.horizon) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'horizon is required (1D, 7D, or 30D)',
      };
    }
    
    const snapshots = await snapshotService.getByHorizon(query.horizon, {
      status: query.status,
      limit: parseInt(query.limit || '100', 10),
    });
    
    // Transform for UI (remove internal fields)
    const timeline = snapshots.map(s => ({
      snapshotId: s.snapshotId,
      symbol: s.symbol,
      horizon: s.horizon,
      prediction: s.prediction,
      predictedClass: s.predictedClass,
      confidence: s.confidence,
      entryPrice: s.entryPrice,
      entryTimestamp: s.entryTimestamp,
      status: s.status,
      outcome: s.outcome,
      exitPrice: s.exitPrice,
      priceChangePercent: s.priceChangePercent,
      modelVersion: s.modelVersion,
      biasModifier: s.biasModifier,
      createdAt: s.createdAt,
    }));
    
    return {
      ok: true,
      data: {
        timeline,
        count: timeline.length,
        horizon: query.horizon,
      },
    };
  });
  
  /**
   * GET /api/market/exchange/snapshots/active
   * Get all active predictions (current state of the ML system).
   */
  fastify.get('/api/market/exchange/snapshots/active', async (request, _reply) => {
    const query = request.query as {
      horizon?: ExchangeHorizon;
      symbol?: string;
    };
    
    const snapshotService = getExchangeSnapshotService(db);
    
    // If specific symbol/horizon requested
    if (query.symbol && query.horizon) {
      const snapshot = await snapshotService.getActive(query.symbol, query.horizon);
      
      if (!snapshot) {
        return {
          ok: true,
          data: {
            snapshot: null,
            message: `No active prediction for ${query.symbol} ${query.horizon}`,
          },
        };
      }
      
      return {
        ok: true,
        data: {
          snapshot: {
            snapshotId: snapshot.snapshotId,
            symbol: snapshot.symbol,
            horizon: snapshot.horizon,
            prediction: snapshot.prediction,
            predictedClass: snapshot.predictedClass,
            confidence: snapshot.confidence,
            entryPrice: snapshot.entryPrice,
            entryTimestamp: snapshot.entryTimestamp,
            modelId: snapshot.modelId,
            modelVersion: snapshot.modelVersion,
            biasModifier: snapshot.biasModifier,
            biasBreakdown: snapshot.biasBreakdown,
            createdAt: snapshot.createdAt,
          },
        },
      };
    }
    
    // Get all active for a horizon
    if (query.horizon) {
      const snapshots = await snapshotService.getAllActiveByHorizon(query.horizon);
      
      const active = snapshots.map(s => ({
        snapshotId: s.snapshotId,
        symbol: s.symbol,
        horizon: s.horizon,
        prediction: s.prediction,
        predictedClass: s.predictedClass,
        confidence: s.confidence,
        entryPrice: s.entryPrice,
        entryTimestamp: s.entryTimestamp,
        modelVersion: s.modelVersion,
        biasModifier: s.biasModifier,
        createdAt: s.createdAt,
      }));
      
      return {
        ok: true,
        data: {
          active,
          count: active.length,
          horizon: query.horizon,
        },
      };
    }
    
    // Get all active across all horizons
    const [active1D, active7D, active30D] = await Promise.all([
      snapshotService.getAllActiveByHorizon('1D'),
      snapshotService.getAllActiveByHorizon('7D'),
      snapshotService.getAllActiveByHorizon('30D'),
    ]);
    
    const transform = (s: any) => ({
      snapshotId: s.snapshotId,
      symbol: s.symbol,
      horizon: s.horizon,
      prediction: s.prediction,
      predictedClass: s.predictedClass,
      confidence: s.confidence,
      entryPrice: s.entryPrice,
      entryTimestamp: s.entryTimestamp,
      modelVersion: s.modelVersion,
      biasModifier: s.biasModifier,
      createdAt: s.createdAt,
    });
    
    return {
      ok: true,
      data: {
        '1D': active1D.map(transform),
        '7D': active7D.map(transform),
        '30D': active30D.map(transform),
        counts: {
          '1D': active1D.length,
          '7D': active7D.length,
          '30D': active30D.length,
        },
      },
    };
  });
  
  /**
   * GET /api/market/exchange/snapshots/stats
   * Get public snapshot statistics.
   */
  fastify.get('/api/market/exchange/snapshots/stats', async (_request, _reply) => {
    const snapshotService = getExchangeSnapshotService(db);
    const stats = await snapshotService.getStats();
    
    return {
      ok: true,
      data: {
        total: stats.total,
        byStatus: stats.byStatus,
        byHorizon: stats.byHorizon,
        accuracy: stats.accuracy,
      },
    };
  });
  
  console.log('[Exchange Snapshot] Public routes registered');
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════

export async function exchangeSnapshotAdminRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  const db = getDb();
  
  /**
   * GET /api/admin/exchange-ml/snapshots/stats
   * Get comprehensive snapshot statistics.
   */
  fastify.get('/api/admin/exchange-ml/snapshots/stats', async (_request, _reply) => {
    const snapshotService = getExchangeSnapshotService(db);
    const stats = await snapshotService.getStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/snapshots/:snapshotId
   * Get specific snapshot details.
   */
  fastify.get('/api/admin/exchange-ml/snapshots/:snapshotId', async (request, _reply) => {
    const params = request.params as { snapshotId: string };
    
    const snapshotService = getExchangeSnapshotService(db);
    const snapshot = await snapshotService.getById(params.snapshotId);
    
    if (!snapshot) {
      return {
        ok: false,
        error: 'NOT_FOUND',
        message: `Snapshot ${params.snapshotId} not found`,
      };
    }
    
    return {
      ok: true,
      data: snapshot,
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/snapshots/init
   * Initialize snapshot indexes.
   */
  fastify.post('/api/admin/exchange-ml/snapshots/init', async (_request, _reply) => {
    try {
      const snapshotService = getExchangeSnapshotService(db);
      await snapshotService.ensureIndexes();
      
      return {
        ok: true,
        data: {
          message: 'Snapshot subsystem initialized',
          indexes: 'created',
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'INIT_FAILED',
        message: err.message,
      };
    }
  });
  
  /**
   * POST /api/admin/exchange-ml/snapshots/create
   * Manually create a snapshot (for testing).
   */
  fastify.post('/api/admin/exchange-ml/snapshots/create', async (request, _reply) => {
    const body = request.body as {
      symbol: string;
      horizon: ExchangeHorizon;
      modelId?: string;
      modelVersion?: number;
      prediction?: number;
      confidence?: number;
      entryPrice?: number;
    };
    
    if (!body.symbol || !body.horizon) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'symbol and horizon are required',
      };
    }
    
    if (!['1D', '7D', '30D'].includes(body.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    const snapshotService = getExchangeSnapshotService(db);
    
    // Use defaults for testing
    const prediction = body.prediction ?? 0.65;
    const predictedClass = prediction >= 0.5 ? 'WIN' : 'LOSS';
    
    const result = await snapshotService.archiveAndCreate({
      symbol: body.symbol,
      horizon: body.horizon,
      modelId: body.modelId || 'test_model',
      modelVersion: body.modelVersion || 1,
      prediction,
      predictedClass,
      confidence: body.confidence ?? prediction,
      entryPrice: body.entryPrice || 100,
    });
    
    return {
      ok: true,
      data: {
        newSnapshot: {
          snapshotId: result.newSnapshot.snapshotId,
          symbol: result.newSnapshot.symbol,
          horizon: result.newSnapshot.horizon,
          prediction: result.newSnapshot.prediction,
          predictedClass: result.newSnapshot.predictedClass,
          confidence: result.newSnapshot.confidence,
          entryPrice: result.newSnapshot.entryPrice,
          status: result.newSnapshot.status,
          createdAt: result.newSnapshot.createdAt,
        },
        archivedSnapshotId: result.archivedSnapshotId,
        wasArchived: result.wasArchived,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-ml/snapshots/resolve
   * Manually resolve a snapshot (for testing).
   */
  fastify.post('/api/admin/exchange-ml/snapshots/resolve', async (request, _reply) => {
    const body = request.body as {
      snapshotId: string;
      exitPrice: number;
    };
    
    if (!body.snapshotId || body.exitPrice === undefined) {
      return {
        ok: false,
        error: 'INVALID_REQUEST',
        message: 'snapshotId and exitPrice are required',
      };
    }
    
    const snapshotService = getExchangeSnapshotService(db);
    const result = await snapshotService.resolveSnapshot(body.snapshotId, body.exitPrice);
    
    return {
      ok: result.resolved,
      data: result,
      error: !result.resolved ? 'RESOLUTION_FAILED' : undefined,
    };
  });
  
  /**
   * GET /api/admin/exchange-ml/snapshots/pending
   * Get snapshots pending resolution.
   */
  fastify.get('/api/admin/exchange-ml/snapshots/pending', async (request, _reply) => {
    const query = request.query as {
      horizon: ExchangeHorizon;
      limit?: string;
    };
    
    if (!query.horizon || !['1D', '7D', '30D'].includes(query.horizon)) {
      return {
        ok: false,
        error: 'INVALID_HORIZON',
        message: 'horizon must be 1D, 7D, or 30D',
      };
    }
    
    // Calculate cutoff based on horizon
    const horizonHours: Record<ExchangeHorizon, number> = {
      '1D': 24,
      '7D': 168,
      '30D': 720,
    };
    
    const cutoff = new Date(Date.now() - horizonHours[query.horizon] * 60 * 60 * 1000);
    
    const snapshotService = getExchangeSnapshotService(db);
    const pending = await snapshotService.getPendingResolution(
      query.horizon,
      cutoff,
      parseInt(query.limit || '100', 10)
    );
    
    return {
      ok: true,
      data: {
        pending: pending.map(s => ({
          snapshotId: s.snapshotId,
          symbol: s.symbol,
          horizon: s.horizon,
          predictedClass: s.predictedClass,
          entryPrice: s.entryPrice,
          entryTimestamp: s.entryTimestamp,
          status: s.status,
        })),
        count: pending.length,
        cutoff,
      },
    };
  });
  
  console.log('[Exchange Snapshot] Admin routes registered');
}

export default { exchangeSnapshotPublicRoutes, exchangeSnapshotAdminRoutes };
