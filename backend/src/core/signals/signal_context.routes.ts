/**
 * Signal Context Routes (P3.3)
 * 
 * API for contextual signals - aggregated related signals
 * 
 * Philosophy:
 * - One signal = noise
 * - Multiple synchronous signals = event
 * - overlapScore = coverage, NOT confidence
 * - NO Buy/Sell, just "what's happening together"
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SignalContextModel } from './signal_context.model.js';
import { ActorSignalModel } from './actor_signal.model.js';

export async function signalContextRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/signals/context
   * Get aggregated signal contexts
   */
  app.get('/signals/context', async (request: FastifyRequest) => {
    const query = request.query as {
      window?: string;
      minOverlap?: string;
      limit?: string;
    };
    
    const filter: any = {
      status: 'active',
    };
    
    if (query.window) {
      filter.window = query.window;
    }
    
    if (query.minOverlap) {
      filter.overlapScore = { $gte: parseInt(query.minOverlap) };
    }
    
    const limit = parseInt(query.limit || '20');
    
    const contexts = await SignalContextModel.find(filter)
      .sort({ overlapScore: -1, detectedAt: -1 })
      .limit(limit)
      .lean();
    
    return {
      ok: true,
      data: {
        contexts: contexts.map((c: any) => ({
          id: c._id.toString(),
          window: c.window,
          primarySignal: c.primarySignal,
          relatedSignals: {
            actorCount: c.relatedSignals?.actors?.length || 0,
            corridorCount: c.relatedSignals?.corridors?.length || 0,
            tokenCount: c.relatedSignals?.tokens?.length || 0,
          },
          overlapScore: c.overlapScore,
          affectedAssets: c.affectedAssets,
          involvedActors: c.involvedActors,
          summary: c.summary,
          narrativeHint: c.narrativeHint,
          detectedAt: c.detectedAt,
        })),
        count: contexts.length,
        disclaimer: 'Contexts aggregate related signals. Not predictions.',
      },
    };
  });
  
  /**
   * GET /api/signals/context/:id
   * Get detailed context by ID
   */
  app.get('/signals/context/:id', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const context = await SignalContextModel.findById(id).lean();
    
    if (!context) {
      return {
        ok: false,
        error: 'CONTEXT_NOT_FOUND',
      };
    }
    
    const c = context as any;
    
    return {
      ok: true,
      data: {
        id: c._id.toString(),
        window: c.window,
        primarySignal: c.primarySignal,
        relatedSignals: c.relatedSignals,
        overlapScore: c.overlapScore,
        affectedAssets: c.affectedAssets,
        involvedActors: c.involvedActors,
        summary: c.summary,
        narrativeHint: c.narrativeHint,
        detectedAt: c.detectedAt,
        status: c.status,
      },
    };
  });
  
  /**
   * GET /api/signals/context/stats
   * Get context statistics
   */
  app.get('/signals/context/stats', async () => {
    const [
      totalActive,
      byWindow,
      avgOverlap,
      topActors,
    ] = await Promise.all([
      SignalContextModel.countDocuments({ status: 'active' }),
      SignalContextModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$window', count: { $sum: 1 } } },
      ]),
      SignalContextModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, avgOverlap: { $avg: '$overlapScore' } } },
      ]),
      SignalContextModel.aggregate([
        { $match: { status: 'active' } },
        { $unwind: '$involvedActors' },
        { $group: { _id: '$involvedActors', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        totalActive,
        byWindow: byWindow.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        avgOverlapScore: Math.round((avgOverlap[0]?.avgOverlap || 0) * 10) / 10,
        topInvolvedActors: topActors.map(a => ({
          actor: a._id,
          contextCount: a.count,
        })),
      },
    };
  });
  
  /**
   * GET /api/actors/:slug/contexts
   * Get contexts involving a specific actor (P3.5)
   */
  app.get('/actors/:slug/contexts', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const { window = '24h', limit = '10' } = request.query as { window?: string; limit?: string };
    
    const contexts = await SignalContextModel.find({
      status: 'active',
      involvedActors: slug,
    })
      .sort({ overlapScore: -1, detectedAt: -1 })
      .limit(parseInt(limit))
      .lean();
    
    return {
      ok: true,
      data: {
        actor: slug,
        contexts: contexts.map((c: any) => ({
          id: c._id.toString(),
          window: c.window,
          overlapScore: c.overlapScore,
          summary: c.summary,
          involvedActors: c.involvedActors,
          detectedAt: c.detectedAt,
        })),
        count: contexts.length,
      },
    };
  });
  
  /**
   * POST /api/signals/context/:id/acknowledge
   * Acknowledge a context
   */
  app.post('/signals/context/:id/acknowledge', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const context = await SignalContextModel.findByIdAndUpdate(
      id,
      { $set: { status: 'acknowledged' } },
      { new: true }
    ).lean();
    
    if (!context) {
      return {
        ok: false,
        error: 'CONTEXT_NOT_FOUND',
      };
    }
    
    return {
      ok: true,
      data: { acknowledged: true },
    };
  });
  
  app.log.info('Signal Context routes registered (P3.3)');
}
