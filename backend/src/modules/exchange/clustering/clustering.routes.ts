/**
 * BLOCK 2.12 — Pattern Clustering Routes
 * =======================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { patternClusterService, DEFAULT_CLUSTER_FEATURES } from './pattern_cluster.service.js';
import { featureStatsService } from './feature_stats.service.js';

export async function registerPatternClusterRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Run clustering
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/patterns/run', async (req: FastifyRequest<{
    Body?: {
      venue?: string;
      marketType?: string;
      tf?: string;
      k?: number;
      limit?: number;
      minQuality?: number;
    };
  }>) => {
    try {
      const result = await patternClusterService.run({
        venue: req.body?.venue ?? 'hyperliquid',
        marketType: (req.body?.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (req.body?.tf ?? '5m') as '5m' | '15m' | '1h',
        k: req.body?.k ?? 12,
        limit: req.body?.limit ?? 500,
        minQuality: req.body?.minQuality ?? 0.5,
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Recompute feature stats
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/market/patterns/stats', async (req: FastifyRequest<{
    Body?: {
      venue?: string;
      marketType?: string;
      tf?: string;
      lookbackHours?: number;
    };
  }>) => {
    try {
      const result = await featureStatsService.recompute({
        venue: req.body?.venue ?? 'hyperliquid',
        marketType: (req.body?.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (req.body?.tf ?? '5m') as '5m' | '15m' | '1h',
        lookbackHours: req.body?.lookbackHours ?? 48,
        minSamples: 50,
        featureKeys: DEFAULT_CLUSTER_FEATURES,
      });
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get latest clusters
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/patterns/latest', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      tf?: string;
    };
  }>) => {
    const venue = req.query.venue ?? 'hyperliquid';
    const marketType = req.query.marketType ?? 'perp';
    const tf = req.query.tf ?? '5m';

    const run = await patternClusterService.getLatestRun({ venue, marketType, tf });
    if (!run) {
      return { ok: false, error: 'No cluster run found' };
    }

    const clusters = await patternClusterService.getClusterSummary(run.clusterRunId);

    return {
      ok: true,
      clusterRunId: run.clusterRunId,
      ts: run.ts,
      k: run.k,
      clusters,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Get cluster members
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/market/patterns/cluster/:clusterRunId/:clusterId', async (req: FastifyRequest<{
    Params: { clusterRunId: string; clusterId: string };
  }>) => {
    const { clusterRunId, clusterId } = req.params;
    const members = await patternClusterService.getClusterMembers(clusterRunId, parseInt(clusterId));

    return {
      ok: true,
      clusterRunId,
      clusterId: parseInt(clusterId),
      count: members.length,
      members: members.map((m) => ({
        symbolKey: m.symbolKey,
        distance: m.distance,
        tags: m.tags,
      })),
    };
  });

  console.log('[Clustering] Routes registered (Block 2.12)');
}
