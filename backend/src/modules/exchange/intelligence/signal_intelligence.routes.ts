/**
 * BLOCKS 2.15-2.21 — Signal Intelligence Routes
 * ==============================================
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { signalIntelligenceService } from './signal_intelligence.service.js';
import { altMoversService } from '../candidates/alt_movers.service.js';

export async function registerSignalIntelligenceRoutes(app: FastifyInstance) {
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get ranked alts with full intelligence
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/ranked', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      tf?: string;
      horizon?: string;
      limit?: string;
    };
  }>) => {
    const q = req.query;
    
    try {
      // First get base movers
      const movers = await altMoversService.build({
        venue: q.venue ?? 'hyperliquid',
        marketType: (q.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (q.tf ?? '5m') as '5m' | '15m' | '1h',
        horizon: (q.horizon ?? '4h') as '1h' | '4h' | '24h',
        winnersThreshold: 0.06,
        lagThreshold: 0.02,
        minClusterSize: 5,
        minMomentum: 0.15,
        topKClusters: 8,
        outLimit: parseInt(q.limit ?? '30'),
      });

      // Enhance with signal intelligence
      const items = await Promise.all(
        movers.candidates.map(async (c) => {
          const intel = await signalIntelligenceService.buildSignalIntelligence({
            symbolKey: c.symbolKey,
            base: c.base,
            clusterId: c.clusterId,
            clusterRunId: movers.clusterRunId,
            horizon: (q.horizon ?? '4h') as '1h' | '4h' | '24h',
            baseScore: c.score,
            fundingRate: c.tags?.fundingRate ?? 0,
            volumeZ: c.tags?.volumeZ,
            oiChange: c.tags?.oiChange,
            btcCorrelation: 0,
            clusterMovedRatio: c.momentum,
            clusterMovedCount: Math.round(c.momentum * 10),
            clusterTotalCount: 10,
          });

          return {
            symbol: c.base,
            symbolKey: c.symbolKey,
            scoreUp: Math.round(intel.finalScore * 100),
            scoreDown: Math.round((1 - intel.finalScore) * 50),
            confidence: intel.confidence,
            bucket: intel.bucket,
            drivers: {
              base: intel.baseScore,
              fundingRisk: intel.fundingPressureScore,
              macroFit: intel.macroFitScore,
              pattern: intel.patternMemoryScore,
            },
            lifecycle: intel.lifecyclePhase,
            fundingState: intel.fundingState,
            explain: intel.reasons,
          };
        })
      );

      // Sort by final score
      items.sort((a, b) => b.scoreUp - a.scoreUp);

      return {
        ok: true,
        asOf: movers.ts,
        horizon: q.horizon ?? '4h',
        items,
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Get cluster lifecycle status (Block 2.19)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/buckets/status', async (req: FastifyRequest<{
    Querystring: {
      clusterRunId?: string;
      clusterId?: string;
      horizon?: string;
    };
  }>) => {
    const q = req.query;

    if (!q.clusterRunId || !q.clusterId) {
      return { ok: false, error: 'clusterRunId and clusterId required' };
    }

    const lifecycle = await signalIntelligenceService.computeClusterLifecycle(
      q.clusterRunId,
      parseInt(q.clusterId),
      (q.horizon ?? '4h') as '1h' | '4h' | '24h',
      0.06
    );

    const recommendation = lifecycle.phase === 'EXPANSION' ? 'FOLLOW' :
                          lifecycle.phase === 'PEAK' ? 'REDUCE' :
                          lifecycle.phase === 'DECAY' ? 'EXIT' :
                          lifecycle.phase === 'DEATH' ? 'IGNORE' : 'WATCH';

    return {
      ok: true,
      bucketId: parseInt(q.clusterId),
      phase: lifecycle.phase,
      tdf: lifecycle.timeDecayFactor,
      movedRatio: lifecycle.movedRatio,
      strengthDecay: lifecycle.strengthDecay,
      recommendation,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN: Debug signal intelligence for symbol
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/admin/market/alts/:symbol/score-debug', async (req: FastifyRequest<{
    Params: { symbol: string };
    Querystring: { horizon?: string };
  }>) => {
    const { symbol } = req.params;
    const horizon = (req.query.horizon ?? '4h') as '1h' | '4h' | '24h';

    // Build mock intel for debugging
    const intel = await signalIntelligenceService.buildSignalIntelligence({
      symbolKey: `${symbol}:USDT:perp:hyperliquid`,
      base: symbol,
      clusterId: 0,
      clusterRunId: 'debug',
      horizon,
      baseScore: 0.6,
      fundingRate: 0.01,
      volumeZ: 0.5,
      oiChange: 0.05,
      btcCorrelation: 0.3,
      clusterMovedRatio: 0.4,
      clusterMovedCount: 4,
      clusterTotalCount: 10,
    });

    return {
      ok: true,
      symbol,
      horizon,
      ...intel,
      raw: {
        note: 'Use with actual cluster data for accurate results',
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC: Pattern buckets view (Block 2.18)
  // ═══════════════════════════════════════════════════════════════

  app.get('/api/market/alts/buckets', async (req: FastifyRequest<{
    Querystring: {
      venue?: string;
      marketType?: string;
      tf?: string;
      horizon?: string;
    };
  }>) => {
    const q = req.query;

    try {
      const movers = await altMoversService.build({
        venue: q.venue ?? 'hyperliquid',
        marketType: (q.marketType ?? 'perp') as 'spot' | 'perp',
        tf: (q.tf ?? '5m') as '5m' | '15m' | '1h',
        horizon: (q.horizon ?? '4h') as '1h' | '4h' | '24h',
        winnersThreshold: 0.06,
        lagThreshold: 0.02,
        minClusterSize: 3,
        minMomentum: 0.10,
        topKClusters: 10,
        outLimit: 100,
      });

      // Group candidates by cluster
      const buckets = movers.hotClusters.map((hc) => {
        const clusterCandidates = movers.candidates.filter(c => c.clusterId === hc.clusterId);
        const moved = clusterCandidates.filter(c => c.ret >= 0.06);
        const lagging = clusterCandidates.filter(c => c.ret < 0.02);

        return {
          bucketId: hc.clusterId,
          winRate: hc.momentum,
          avgMove: hc.momentum * 10, // Approximate
          size: hc.size,
          symbols: clusterCandidates.map(c => c.base),
          moved: moved.map(c => c.base),
          candidates: lagging.slice(0, 5).map(c => c.base),
        };
      });

      return {
        ok: true,
        ts: movers.ts,
        buckets,
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  console.log('[SignalIntelligence] Routes registered (Blocks 2.15-2.21)');
}
