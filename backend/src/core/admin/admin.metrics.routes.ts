/**
 * Admin Metrics API - STEP 0.5
 * 
 * Cached metrics endpoints. Данные предрасчитываются cron jobs.
 * TTL: 60-300 секунд.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { requireAdminAuth } from './admin.middleware.js';

// ============================================
// METRICS CACHE MODEL
// ============================================
const metricsCache = mongoose.model('AdminMetricsCache', new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  data: { type: mongoose.Schema.Types.Mixed },
  expiresAt: { type: Date, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { collection: 'admin_metrics_cache' }));

// TTL index
metricsCache.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});

// ============================================
// CACHE HELPERS
// ============================================
const DEFAULT_TTL_SECONDS = 120; // 2 minutes

async function getCachedMetrics(key: string): Promise<any | null> {
  const cached = await metricsCache.findOne({ 
    key, 
    expiresAt: { $gt: new Date() } 
  }).lean();
  return cached?.data || null;
}

async function setCachedMetrics(key: string, data: any, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await metricsCache.updateOne(
    { key },
    { $set: { data, expiresAt, updatedAt: new Date() } },
    { upsert: true }
  );
}

// ============================================
// COMPUTE FUNCTIONS (вызываются при cache miss)
// ============================================

async function computeAccuracyMetrics(): Promise<any> {
  const { AccuracySnapshotModel } = await import('../ml/validation/accuracy_snapshot.model.js');
  const { DriftEventModel } = await import('../ml/validation/drift_event.model.js');
  
  const [snapshots, drifts] = await Promise.all([
    AccuracySnapshotModel.find({ window: '7d' })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    DriftEventModel.find({ acknowledged: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
  ]);
  
  // Aggregate by network
  const byNetwork: Record<string, any> = {};
  for (const s of snapshots) {
    if (!byNetwork[s.network]) {
      byNetwork[s.network] = {
        accuracy: s.accuracy,
        total: s.total,
        correct: s.correct,
        updatedAt: s.createdAt,
      };
    }
  }
  
  return {
    networks: byNetwork,
    activeDrifts: drifts.length,
    lastUpdated: Date.now(),
  };
}

async function computePipelineMetrics(): Promise<any> {
  const { getPipelinesStatus } = await import('./pipelines.service.js');
  const status = await getPipelinesStatus();
  
  return {
    stages: status.stages?.map((s: any) => ({
      name: s.name,
      status: s.status,
      lastRun: s.lastRun,
      rowCount: s.rowCount,
    })) || [],
    lastUpdated: Date.now(),
  };
}

async function computeSignalMetrics(): Promise<any> {
  const { SignalOutcomeModel } = await import('../ml/validation/signal_outcome.model.js');
  
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  
  const [total24h, total7d, correct7d] = await Promise.all([
    SignalOutcomeModel.countDocuments({ validatedAt: { $gte: oneDayAgo } }),
    SignalOutcomeModel.countDocuments({ validatedAt: { $gte: sevenDaysAgo } }),
    SignalOutcomeModel.countDocuments({ validatedAt: { $gte: sevenDaysAgo }, correct: true }),
  ]);
  
  return {
    signals24h: total24h,
    signals7d: total7d,
    accuracy7d: total7d > 0 ? correct7d / total7d : null,
    lastUpdated: Date.now(),
  };
}

// ============================================
// ROUTES
// ============================================
export async function adminMetricsRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /admin/metrics/accuracy
   * Accuracy metrics by network (cached)
   */
  app.get('/metrics/accuracy', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cacheKey = 'metrics:accuracy';
      let data = await getCachedMetrics(cacheKey);
      
      if (!data) {
        data = await computeAccuracyMetrics();
        await setCachedMetrics(cacheKey, data, 120);
      }
      
      return reply.send({ ok: true, data, cached: !!data });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/metrics/pipelines
   * Pipeline status (cached)
   */
  app.get('/metrics/pipelines', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cacheKey = 'metrics:pipelines';
      let data = await getCachedMetrics(cacheKey);
      
      if (!data) {
        data = await computePipelineMetrics();
        await setCachedMetrics(cacheKey, data, 60);
      }
      
      return reply.send({ ok: true, data, cached: !!data });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/metrics/signals
   * Signal validation metrics (cached)
   */
  app.get('/metrics/signals', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const cacheKey = 'metrics:signals';
      let data = await getCachedMetrics(cacheKey);
      
      if (!data) {
        data = await computeSignalMetrics();
        await setCachedMetrics(cacheKey, data, 180);
      }
      
      return reply.send({ ok: true, data, cached: !!data });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /admin/metrics/all
   * All metrics combined (for dashboard)
   */
  app.get('/metrics/all', {
    preHandler: [requireAdminAuth(['ADMIN', 'MODERATOR'])],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [accuracy, pipelines, signals] = await Promise.all([
        getCachedMetrics('metrics:accuracy').then(d => d || computeAccuracyMetrics()),
        getCachedMetrics('metrics:pipelines').then(d => d || computePipelineMetrics()),
        getCachedMetrics('metrics:signals').then(d => d || computeSignalMetrics()),
      ]);
      
      return reply.send({
        ok: true,
        data: { accuracy, pipelines, signals },
        timestamp: Date.now(),
      });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /admin/metrics/invalidate
   * Force cache refresh (admin only)
   */
  app.post('/metrics/invalidate', {
    preHandler: [requireAdminAuth(['ADMIN'])],
  }, async (request: FastifyRequest<{ Body: { key?: string } }>, reply: FastifyReply) => {
    try {
      const { key } = request.body || {};
      
      if (key) {
        await metricsCache.deleteOne({ key: `metrics:${key}` });
      } else {
        await metricsCache.deleteMany({});
      }
      
      return reply.send({ ok: true, message: 'Cache invalidated' });
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });

  console.log('[Admin] Metrics API routes registered (STEP 0.5)');
}

export default adminMetricsRoutes;
