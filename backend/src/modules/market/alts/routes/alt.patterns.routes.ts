/**
 * BLOCK 2.7 — Pattern Clusters Routes
 * =====================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { altPatternClustererService } from '../services/alt.pattern.clusterer.service.js';
import type { Horizon } from '../db/types.js';
import type { Window } from '../db/pattern.cluster.types.js';

export async function registerAltPatternsRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // GET PATTERN CLUSTERS
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/pattern-clusters', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      window?: string;
      limit?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as Horizon;
    const window = (req.query.window ?? '24h') as Window;
    const limit = parseInt(req.query.limit ?? '100');

    const rows = await altPatternClustererService.getClusters(horizon, window, limit);
    return { ok: true, count: rows.length, rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET SINGLE CLUSTER
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/pattern-clusters/:clusterId', async (req: FastifyRequest<{
    Params: { clusterId: string };
    Querystring: {
      horizon?: string;
      window?: string;
    };
  }>) => {
    const { clusterId } = req.params;
    const horizon = (req.query.horizon ?? '4h') as Horizon;
    const window = (req.query.window ?? '24h') as Window;

    const row = await altPatternClustererService.getCluster(clusterId, horizon, window);
    if (!row) {
      return { ok: false, error: 'Cluster not found' };
    }
    return { ok: true, row };
  });

  // ═══════════════════════════════════════════════════════════════
  // GET NEXT CANDIDATES (from winning clusters)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/pattern-next', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      window?: string;
      minSim?: string;
      limit?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as Horizon;
    const window = (req.query.window ?? '24h') as Window;
    const minSim = parseFloat(req.query.minSim ?? '0.92');
    const limit = parseInt(req.query.limit ?? '20');

    const rows = await altPatternClustererService.getNextCandidates({
      horizon,
      window,
      minSim,
      limit,
    });

    return { ok: true, count: rows.length, rows };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: RECOMPUTE CLUSTERS
  // ═══════════════════════════════════════════════════════════════

  app.post('/api/admin/alts/patterns/recompute', async (req: FastifyRequest<{
    Querystring: {
      horizon?: string;
      window?: string;
      simThreshold?: string;
    };
  }>) => {
    const horizon = (req.query.horizon ?? '4h') as Horizon;
    const window = (req.query.window ?? '24h') as Window;
    const simThreshold = parseFloat(req.query.simThreshold ?? '0.92');

    const result = await altPatternClustererService.recompute({
      horizon,
      window,
      simThreshold,
    });

    return result;
  });

  console.log('[Alts] Patterns Routes registered');
}
