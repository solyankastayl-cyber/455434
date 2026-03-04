/**
 * Actor Signals Routes (Sprint 3 - Signals Layer v2)
 * 
 * API endpoints for actor behavior deviations
 * 
 * Philosophy:
 * - Signals = observed deviations, NOT predictions
 * - severity = degree of deviation
 * - NO buy/sell/bullish/bearish language
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ActorSignalModel } from './actor_signal.model.js';
import { ActorBaselineModel } from './actor_baseline.model.js';

export async function actorSignalsRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/actors/:slug/signals
   * Get signals for a specific actor
   */
  app.get('/actors/:slug/signals', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const { window = '24h', limit = '20' } = request.query as { window?: string; limit?: string };
    
    const signals = await ActorSignalModel.find({
      actorSlug: slug,
      status: 'active',
    })
      .sort({ detectedAt: -1 })
      .limit(parseInt(limit))
      .lean();
    
    // Get baseline for context
    const baseline = await ActorBaselineModel.findOne({
      actorSlug: slug,
      window: '7d',
    }).lean();
    
    return {
      ok: true,
      data: {
        signals: signals.map(s => ({
          id: (s as any)._id.toString(),
          signalType: s.signalType,
          metric: s.metric,
          deviation: s.deviation,
          window: s.window,
          detectedAt: s.detectedAt,
          interpretation: s.interpretation,
          severity: s.severity,
          evidence: s.evidence,
        })),
        baseline: baseline ? {
          window: (baseline as any).window,
          flows: (baseline as any).flows,
          behavior: (baseline as any).behavior,
          calculatedAt: (baseline as any).calculatedAt,
        } : null,
        count: signals.length,
        disclaimer: 'Signals reflect observed deviations from baseline, not predictions.',
      },
    };
  });
  
  /**
   * GET /api/signals/actors
   * Get all actor signals (market-level view)
   */
  app.get('/signals/actors', async (request: FastifyRequest) => {
    const query = request.query as {
      window?: string;
      type?: string;         // actorType filter
      signalType?: string;   // signal type filter
      severity?: string;
      limit?: string;
    };
    
    const filter: any = {
      status: 'active',
    };
    
    if (query.type) {
      filter.actorType = query.type;
    }
    
    if (query.signalType) {
      filter.signalType = query.signalType;
    }
    
    if (query.severity) {
      filter.severity = query.severity;
    }
    
    const limit = parseInt(query.limit || '50');
    
    const signals = await ActorSignalModel.find(filter)
      .sort({ severity: -1, detectedAt: -1 }) // High severity first
      .limit(limit)
      .lean();
    
    // Group by signal type for summary
    const byType = signals.reduce((acc, s) => {
      acc[s.signalType] = (acc[s.signalType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const bySeverity = signals.reduce((acc, s) => {
      acc[s.severity] = (acc[s.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return {
      ok: true,
      data: {
        signals: signals.map(s => ({
          id: (s as any)._id.toString(),
          actorSlug: s.actorSlug,
          actorType: s.actorType,
          signalType: s.signalType,
          metric: s.metric,
          deviation: s.deviation,
          window: s.window,
          detectedAt: s.detectedAt,
          interpretation: s.interpretation,
          severity: s.severity,
        })),
        summary: {
          total: signals.length,
          byType,
          bySeverity,
        },
        disclaimer: 'Signals = observed behavior deviations. Not predictions.',
      },
    };
  });
  
  /**
   * GET /api/signals/actors/stats
   * Get signal statistics
   */
  app.get('/signals/actors/stats', async () => {
    const [
      totalActive,
      byType,
      bySeverity,
      byActorType,
      recentHigh,
    ] = await Promise.all([
      ActorSignalModel.countDocuments({ status: 'active' }),
      ActorSignalModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$signalType', count: { $sum: 1 } } },
      ]),
      ActorSignalModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      ActorSignalModel.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$actorType', count: { $sum: 1 } } },
      ]),
      ActorSignalModel.find({ status: 'active', severity: 'high' })
        .sort({ detectedAt: -1 })
        .limit(5)
        .lean(),
    ]);
    
    return {
      ok: true,
      data: {
        totalActive,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        bySeverity: bySeverity.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        byActorType: byActorType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        recentHighSeverity: recentHigh.map(s => ({
          actorSlug: s.actorSlug,
          signalType: s.signalType,
          interpretation: s.interpretation,
          detectedAt: s.detectedAt,
        })),
      },
    };
  });
  
  /**
   * POST /api/signals/actors/:id/acknowledge
   * Mark a signal as acknowledged
   */
  app.post('/signals/actors/:id/acknowledge', async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    
    const signal = await ActorSignalModel.findByIdAndUpdate(
      id,
      { $set: { status: 'acknowledged' } },
      { new: true }
    ).lean();
    
    if (!signal) {
      return {
        ok: false,
        error: 'SIGNAL_NOT_FOUND',
      };
    }
    
    return {
      ok: true,
      data: { acknowledged: true },
    };
  });
  
  /**
   * GET /api/actors/:slug/baseline
   * Get baseline data for an actor
   */
  app.get('/actors/:slug/baseline', async (request: FastifyRequest) => {
    const { slug } = request.params as { slug: string };
    const { window = '7d' } = request.query as { window?: string };
    
    const baseline = await ActorBaselineModel.findOne({
      actorSlug: slug,
      window,
    }).lean();
    
    if (!baseline) {
      return {
        ok: false,
        error: 'BASELINE_NOT_FOUND',
        message: 'No baseline calculated yet for this actor',
      };
    }
    
    const b = baseline as any;
    
    return {
      ok: true,
      data: {
        actorSlug: b.actorSlug,
        actorType: b.actorType,
        window: b.window,
        flows: b.flows,
        behavior: b.behavior,
        calculatedAt: b.calculatedAt,
        dataPoints: b.dataPoints,
      },
    };
  });
  
  app.log.info('Actor Signals routes registered (Sprint 3 - Signals v2)');
}
