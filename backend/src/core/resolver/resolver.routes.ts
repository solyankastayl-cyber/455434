/**
 * Universal Resolver Routes (Phase 15.5.2)
 * 
 * Single endpoint: ANY input → Resolution with context
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import * as resolverService from './resolver.service.js';

export async function resolverRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/resolve
   * Universal resolver - resolves any input to entity type + ID with full context
   * 
   * Query params:
   *   - input: string (required) - Address, ENS, symbol, tx hash
   * 
   * Returns:
   *   - type: 'actor' | 'token' | 'entity' | 'tx' | 'ens' | 'unknown'
   *   - confidence: 0-1 score
   *   - reason: Human-readable explanation
   *   - suggestions: Actionable next steps
   *   - status: 'resolved' | 'pending' | 'indexing' | 'insufficient_data'
   *   - available: { profile, market, signals, trust, reputation, transfers, relations }
   */
  app.get('/resolve', async (request: FastifyRequest) => {
    const query = request.query as { input?: string };
    
    if (!query.input) {
      return {
        ok: false,
        error: 'MISSING_INPUT',
        message: 'Query parameter "input" is required',
      };
    }
    
    const resolution = await resolverService.resolve(query.input);
    
    return {
      ok: true,
      data: resolution,
    };
  });
  
  /**
   * POST /api/resolve/batch
   * Resolve multiple inputs at once
   * 
   * Body:
   *   - inputs: string[]
   */
  app.post('/resolve/batch', async (request: FastifyRequest) => {
    const body = request.body as { inputs?: string[] };
    
    if (!body.inputs || !Array.isArray(body.inputs)) {
      return {
        ok: false,
        error: 'INVALID_BODY',
        message: 'Body must contain "inputs" array',
      };
    }
    
    if (body.inputs.length > 50) {
      return {
        ok: false,
        error: 'TOO_MANY_INPUTS',
        message: 'Maximum 50 inputs per batch',
      };
    }
    
    const resolutions = await Promise.all(
      body.inputs.map(input => resolverService.resolve(input))
    );
    
    return {
      ok: true,
      data: resolutions,
      count: resolutions.length,
    };
  });
  
  /**
   * GET /api/resolve/cache/stats
   * Get resolution cache statistics
   */
  app.get('/resolve/cache/stats', async () => {
    const { ResolutionModel } = await import('./resolution.model.js');
    
    const [total, expired, byType, byStatus] = await Promise.all([
      ResolutionModel.countDocuments(),
      ResolutionModel.countDocuments({ expiresAt: { $lt: new Date() } }),
      ResolutionModel.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      ResolutionModel.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        totalCached: total,
        expired,
        active: total - expired,
        byType: byType.reduce((acc, item) => {
          acc[item._id] = item.count;
          return acc;
        }, {} as Record<string, number>),
        byStatus: byStatus.reduce((acc, item) => {
          acc[item._id || 'unknown'] = item.count;
          return acc;
        }, {} as Record<string, number>),
      },
    };
  });
  
  /**
   * POST /api/resolve/cache/clear
   * Clear expired cache entries
   */
  app.post('/resolve/cache/clear', async () => {
    const cleared = await resolverService.clearExpiredResolutions();
    
    return {
      ok: true,
      data: {
        clearedCount: cleared,
      },
    };
  });
  
  /**
   * GET /api/resolve/indexer-status
   * Get indexer status for UI status banner (resolver-specific)
   */
  app.get('/resolve/indexer-status', async () => {
    const [indexerStatus, bootstrapStats] = await Promise.all([
      resolverService.getIndexerStatus(),
      resolverService.getBootstrapStats(),
    ]);
    
    return {
      ok: true,
      data: {
        ...indexerStatus,
        bootstrap: bootstrapStats,
      },
    };
  });
  
  /**
   * GET /api/resolve/bootstrap-queue
   * Get bootstrap queue stats
   */
  app.get('/resolve/bootstrap-queue', async () => {
    const stats = await resolverService.getBootstrapStats();
    
    return {
      ok: true,
      data: stats,
    };
  });
  
  app.log.info('Resolver routes registered (v2 - with maturity)');
}
