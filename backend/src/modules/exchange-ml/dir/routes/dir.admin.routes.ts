/**
 * Direction Admin Routes
 * ======================
 * 
 * Admin endpoints for Direction Model management:
 * - Backfill samples
 * - Train models
 * - Activate/Shadow models
 * - View status
 */

import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import mongoose from 'mongoose';
import { Horizon } from '../../contracts/exchange.types.js';
import { DirBackfillService } from '../jobs/dir_backfill.job.js';
import { DirTrainService } from '../dir.train.service.js';
import { getDirPriceAdapter } from '../ports/dir.price.adapter.js';
import { getSyntheticDirPriceAdapter } from '../ports/synthetic.price.adapter.js';
import { DirFeatureDeps } from '../dir.feature-extractor.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION (Fastify Plugin format)
// ═══════════════════════════════════════════════════════════════

export async function dirAdminRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Get DB from mongoose connection
  const db = mongoose.connection.db;
  
  if (!db) {
    console.error('[DirAdmin] MongoDB not connected');
    return;
  }
  
  // Check if we have real price data
  const priceBarCount = await db.collection('price_bars').countDocuments({});
  const useRealData = priceBarCount > 0;
  
  // Create dependencies
  const priceAdapter = useRealData 
    ? getDirPriceAdapter() 
    : getSyntheticDirPriceAdapter();
  
  console.log(`[DirAdmin] Using ${useRealData ? 'REAL' : 'SYNTHETIC'} price data (${priceBarCount} bars in DB)`);
  
  const featureDeps: DirFeatureDeps = {
    price: priceAdapter,
    getFlowBias: async (_symbol: string, _t: number) => {
      // TODO: Wire to real flow bias service
      return 0;
    },
  };
  
  const backfillService = new DirBackfillService(db, featureDeps);
  const trainService = new DirTrainService(db);
  
  await trainService.ensureIndexes();
  
  // ═══════════════════════════════════════════════════════════════
  // STATUS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-dir/status
   * Get Direction Model status
   */
  fastify.get('/api/admin/exchange-dir/status', async () => {
    const [backfillStats, registryState] = await Promise.all([
      backfillService.getStats(),
      trainService.getRegistryState(),
    ]);
    
    return {
      ok: true,
      data: {
        samples: backfillStats,
        models: registryState,
      },
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // BACKFILL
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/admin/exchange-dir/backfill
   * Backfill historical samples
   * 
   * Query params:
   * - symbol: Trading pair (default: BTCUSDT)
   * - days: Number of days to backfill (default: 365)
   */
  fastify.post('/api/admin/exchange-dir/backfill', async (request) => {
    const query = request.query as {
      symbol?: string;
      days?: string;
    };
    
    const symbol = query.symbol || 'BTCUSDT';
    const days = parseInt(query.days || '365', 10);
    
    const now = Math.floor(Date.now() / 1000);
    const fromTs = now - days * 86400;
    const toTs = now - 86400; // Exclude today
    
    console.log(`[DirAdmin] Starting backfill: ${symbol}, ${days} days`);
    
    // Run backfill
    const result = await backfillService.backfill({
      symbol,
      fromTs,
      toTs,
      onProgress: (p) => {
        if (p.processed % 100 === 0) {
          console.log(`[DirAdmin] Backfill progress: ${p.processed}/${p.total} (${p.currentDate})`);
        }
      },
    });
    
    return {
      ok: result.success,
      data: result,
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // TRAINING
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/admin/exchange-dir/train
   * Train Direction Model
   * 
   * Query params:
   * - horizon: 1D, 7D, 30D, or 'all' (default: all)
   * - symbol: Filter by symbol (optional)
   * - activate: Auto-activate trained model (default: false)
   */
  fastify.post('/api/admin/exchange-dir/train', async (request) => {
    const query = request.query as {
      horizon?: string;
      symbol?: string;
      activate?: string;
    };
    
    const horizonParam = query.horizon || 'all';
    const symbol = query.symbol;
    const autoActivate = query.activate === 'true';
    
    console.log(`[DirAdmin] Starting training: horizon=${horizonParam}, symbol=${symbol || 'all'}, activate=${query.activate}, autoActivate=${autoActivate}`);
    
    let results;
    
    if (horizonParam === 'all') {
      results = await trainService.trainAll({ symbol });
    } else {
      const horizon = horizonParam as Horizon;
      const result = await trainService.trainForHorizon({ horizon, symbol });
      results = [result];
    }
    
    // Auto-activate successful models
    if (autoActivate) {
      for (const result of results) {
        if (result.success && result.modelId) {
          await trainService.activateModel(result.horizon, result.modelId);
        }
      }
    }
    
    return {
      ok: results.every(r => r.success),
      data: {
        results,
        activated: autoActivate,
      },
    };
  });
  
  /**
   * POST /api/admin/exchange-dir/activate
   * Activate a model for a horizon
   * 
   * Query params or body:
   * - horizon: 1D, 7D, 30D
   * - modelId: Model ID to activate
   */
  fastify.post('/api/admin/exchange-dir/activate', async (request) => {
    const query = request.query as { horizon?: string; modelId?: string };
    const body = request.body as { horizon?: string; modelId?: string } | null;
    
    const horizon = query.horizon || body?.horizon;
    const modelId = query.modelId || body?.modelId;
    
    if (!horizon || !modelId) {
      return { ok: false, error: 'horizon and modelId required' };
    }
    
    const success = await trainService.activateModel(
      horizon as Horizon,
      modelId
    );
    
    return { ok: success };
  });
  
  /**
   * POST /api/admin/exchange-dir/shadow
   * Set shadow model for a horizon
   */
  fastify.post('/api/admin/exchange-dir/shadow', async (request) => {
    const query = request.query as {
      horizon?: string;
      modelId?: string;
    };
    
    if (!query.horizon || !query.modelId) {
      return { ok: false, error: 'horizon and modelId required' };
    }
    
    const success = await trainService.setShadowModel(
      query.horizon as Horizon,
      query.modelId
    );
    
    return { ok: success };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // MODEL LIST
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/exchange-dir/models
   * List models for a horizon
   */
  fastify.get('/api/admin/exchange-dir/models', async (request) => {
    const query = request.query as {
      horizon?: string;
      limit?: string;
    };
    
    const horizon = (query.horizon || '7D') as Horizon;
    const limit = parseInt(query.limit || '10', 10);
    
    const models = await trainService.listModels(horizon, limit);
    
    return {
      ok: true,
      data: { horizon, models },
    };
  });
  
  console.log('[DirAdmin] Routes registered');
}

// Export for app.ts
export { dirAdminRoutes as registerDirAdminRoutes };

console.log('[Exchange ML] Direction admin routes loaded');
