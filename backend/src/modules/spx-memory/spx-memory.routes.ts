/**
 * SPX MEMORY LAYER — API Routes
 * 
 * BLOCK B6.1 — Admin endpoints for snapshot/outcome management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SpxMemoryWriter } from './spx-memory.writer.js';
import { SpxOutcomeResolver } from './spx-outcome.resolver.js';
import { SpxSnapshotModel } from './spx-snapshot.model.js';
import { SpxOutcomeModel } from './spx-outcome.model.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxMemoryRoutes(fastify: FastifyInstance) {
  const writer = new SpxMemoryWriter(fastify);
  const resolver = new SpxOutcomeResolver(fastify);
  
  const prefix = '/api/spx/v2.1/admin/memory';

  // ═══════════════════════════════════════════════════════════════
  // SNAPSHOT ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/spx/v2.1/admin/memory/write
   * 
   * Write snapshots for given date/horizons
   */
  fastify.post(`${prefix}/write`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as any;

    if (!body.asOfDate) {
      return reply.code(400).send({ 
        ok: false, 
        error: 'asOfDate required (YYYY-MM-DD)' 
      });
    }

    const result = await writer.writeSnapshots({
      asOfDate: body.asOfDate,
      source: body.source || 'LIVE',
      preset: body.preset || 'BALANCED',
      horizons: body.horizons || ['7d', '14d', '30d', '90d', '180d', '365d'],
      policyHash: body.policyHash || 'spx-policy-v1',
      engineVersion: body.engineVersion || 'spx-v2.1.0',
      dryRun: Boolean(body.dryRun),
    });

    return reply.send(result);
  });

  /**
   * GET /api/spx/v2.1/admin/memory/snapshots
   * 
   * List snapshots with filters
   */
  fastify.get(`${prefix}/snapshots`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { 
      source?: string; 
      horizon?: string; 
      startDate?: string;
      endDate?: string;
      limit?: string;
    };

    const filter: any = { symbol: 'SPX' };
    if (query.source) filter.source = query.source;
    if (query.horizon) filter.horizon = query.horizon;
    if (query.startDate || query.endDate) {
      filter.asOfDate = {};
      if (query.startDate) filter.asOfDate.$gte = query.startDate;
      if (query.endDate) filter.asOfDate.$lte = query.endDate;
    }

    const limit = parseInt(query.limit || '100', 10);

    const snapshots = await SpxSnapshotModel.find(filter)
      .sort({ asOfDate: -1, horizon: 1 })
      .limit(limit)
      .lean();

    const total = await SpxSnapshotModel.countDocuments(filter);

    return reply.send({
      ok: true,
      total,
      returned: snapshots.length,
      snapshots,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // OUTCOME ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/spx/v2.1/admin/memory/resolve
   * 
   * Resolve matured outcomes
   */
  fastify.post(`${prefix}/resolve`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as any;
    
    const asOfDateMax = body.asOfDateMax || new Date().toISOString().slice(0, 10);
    const limit = body.limit || 500;

    const result = await resolver.resolveMatured(asOfDateMax, limit);
    return reply.send(result);
  });

  /**
   * GET /api/spx/v2.1/admin/memory/outcomes
   * 
   * List outcomes with filters
   */
  fastify.get(`${prefix}/outcomes`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { 
      source?: string; 
      horizon?: string; 
      hit?: string;
      limit?: string;
    };

    const filter: any = { symbol: 'SPX' };
    if (query.source) filter.source = query.source;
    if (query.horizon) filter.horizon = query.horizon;
    if (query.hit === 'true') filter.hit = true;
    if (query.hit === 'false') filter.hit = false;

    const limit = parseInt(query.limit || '100', 10);

    const outcomes = await SpxOutcomeModel.find(filter)
      .sort({ resolvedDate: -1 })
      .limit(limit)
      .lean();

    const total = await SpxOutcomeModel.countDocuments(filter);

    return reply.send({
      ok: true,
      total,
      returned: outcomes.length,
      outcomes,
    });
  });

  /**
   * GET /api/spx/v2.1/admin/memory/attribution
   * 
   * Get attribution stats (hit rate, returns by source/horizon)
   */
  fastify.get(`${prefix}/attribution`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { source?: string; horizon?: string };
    
    const stats = await resolver.getAttributionStats({
      source: query.source,
      horizon: query.horizon,
    });

    return reply.send({
      ok: true,
      stats,
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // STATS ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/spx/v2.1/admin/memory/stats
   * 
   * Overview stats of SPX memory layer
   */
  fastify.get(`${prefix}/stats`, async (req: FastifyRequest, reply: FastifyReply) => {
    const [snapshotCount, outcomeCount, sourceBreakdown] = await Promise.all([
      SpxSnapshotModel.countDocuments({ symbol: 'SPX' }),
      SpxOutcomeModel.countDocuments({ symbol: 'SPX' }),
      SpxSnapshotModel.aggregate([
        { $match: { symbol: 'SPX' } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const [dateRange] = await SpxSnapshotModel.aggregate([
      { $match: { symbol: 'SPX' } },
      {
        $group: {
          _id: null,
          minDate: { $min: '$asOfDate' },
          maxDate: { $max: '$asOfDate' },
        },
      },
    ]);

    return reply.send({
      ok: true,
      snapshotCount,
      outcomeCount,
      sourceBreakdown: sourceBreakdown.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {} as Record<string, number>),
      dateRange: dateRange ? { 
        from: dateRange.minDate, 
        to: dateRange.maxDate 
      } : null,
    });
  });

  fastify.log.info(`[SPX Memory] Routes registered at ${prefix}/* (BLOCK B6.1 READY)`);
}

export default registerSpxMemoryRoutes;
