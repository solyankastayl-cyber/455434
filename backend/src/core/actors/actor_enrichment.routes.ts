/**
 * Actor Enrichment API Routes (P1.1)
 * 
 * Endpoints for Data Enrichment:
 * - Import actors
 * - Recalculate coverage
 * - Get stats
 * - Seed actors
 */
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { ActorModel } from './actor.model.js';
import { ActorSourceModel } from './actor_source.model.js';
import { 
  importActor, 
  importActorsBatch, 
  getActorStats, 
  recalculateAllCoverage,
  type ActorImportInput 
} from './actor_import.service.js';
import { ACTORS_SEED } from './actors_seed.data.js';
import type { ActorType, SourceLevel } from './actor.types.js';

export const actorEnrichmentRoutes: FastifyPluginAsync = async (fastify) => {
  
  /**
   * POST /api/actors/import
   * Import a single actor with addresses
   */
  fastify.post('/import', async (request: FastifyRequest<{
    Body: {
      name: string;
      type: ActorType;
      addresses: string[];
      source?: SourceLevel;
      tags?: string[];
      labels?: string[];
    }
  }>, reply: FastifyReply) => {
    const { name, type, addresses, source, tags, labels } = request.body;
    
    if (!name || !type || !addresses || addresses.length === 0) {
      return reply.status(400).send({ 
        ok: false, 
        error: 'name, type, and addresses are required' 
      });
    }
    
    try {
      const result = await importActor({
        name,
        type,
        addresses,
        source,
        tags,
        labels,
      });
      
      return { 
        ok: true, 
        data: result,
        message: result.created 
          ? `Created actor ${result.actorId} with ${result.addressesAdded} addresses`
          : `Updated actor ${result.actorId}, added ${result.addressesAdded} addresses`
      };
    } catch (err) {
      console.error('[Actors] Import error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * POST /api/actors/import/batch
   * Import multiple actors at once
   */
  fastify.post('/import/batch', async (request: FastifyRequest<{
    Body: { actors: ActorImportInput[] }
  }>, reply: FastifyReply) => {
    const { actors } = request.body;
    
    if (!actors || !Array.isArray(actors) || actors.length === 0) {
      return reply.status(400).send({ 
        ok: false, 
        error: 'actors array is required' 
      });
    }
    
    try {
      const result = await importActorsBatch(actors);
      
      return { 
        ok: true, 
        data: result,
        message: `Processed ${result.total}: ${result.created} created, ${result.updated} updated`
      };
    } catch (err) {
      console.error('[Actors] Batch import error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * POST /api/actors/coverage/recalculate
   * Recalculate coverage for all actors
   */
  fastify.post('/coverage/recalculate', async (request, reply) => {
    try {
      const result = await recalculateAllCoverage();
      
      return { 
        ok: true, 
        data: result,
        message: `Processed ${result.processed} actors, updated ${result.updated}`
      };
    } catch (err) {
      console.error('[Actors] Coverage recalc error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * GET /api/actors/stats
   * Get actor statistics summary
   */
  fastify.get('/stats', async (request, reply) => {
    try {
      const stats = await getActorStats();
      
      return { 
        ok: true, 
        data: stats,
        interpretation: {
          headline: `${stats.total} actors tracked`,
          coverage: stats.avgCoverage >= 60 
            ? `Good coverage (${stats.avgCoverage}% avg)`
            : `Low coverage (${stats.avgCoverage}% avg) - more data needed`,
          readyForHighConfidence: stats.withHighCoverage,
        }
      };
    } catch (err) {
      console.error('[Actors] Stats error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * GET /api/actors/list
   * Get list of actors with filters
   */
  fastify.get('/list', async (request: FastifyRequest<{
    Querystring: {
      type?: string;
      source?: string;
      coverageBand?: string;
      minCoverage?: string;
      limit?: string;
    }
  }>, reply) => {
    const { type, source, coverageBand, minCoverage, limit } = request.query;
    
    try {
      const query: any = {};
      
      if (type) query.type = type;
      if (source) query.sourceLevel = source;
      if (coverageBand) query['coverage.band'] = coverageBand;
      if (minCoverage) query['coverage.score'] = { $gte: parseInt(minCoverage) };
      
      const actors = await ActorModel.find(query)
        .sort({ 'coverage.score': -1 })
        .limit(Math.min(parseInt(limit || '50'), 100))
        .select('id name type sourceLevel coverage addressStats addresses')
        .lean();
      
      return { 
        ok: true, 
        data: { 
          actors,
          total: actors.length,
        }
      };
    } catch (err) {
      console.error('[Actors] List error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * GET /api/actors/:actorId
   * Get single actor details
   */
  fastify.get('/:actorId', async (request: FastifyRequest<{
    Params: { actorId: string }
  }>, reply) => {
    const { actorId } = request.params;
    
    try {
      const actor = await ActorModel.findOne({ id: actorId }).lean();
      
      if (!actor) {
        return reply.status(404).send({ ok: false, error: 'Actor not found' });
      }
      
      // Get source history
      const sources = await ActorSourceModel.find({ actorId })
        .sort({ importedAt: -1 })
        .limit(10)
        .lean();
      
      return { 
        ok: true, 
        data: { 
          ...actor,
          sources,
        }
      };
    } catch (err) {
      console.error('[Actors] Get error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * DELETE /api/actors/:actorId
   * Delete an actor
   */
  fastify.delete('/:actorId', async (request: FastifyRequest<{
    Params: { actorId: string }
  }>, reply) => {
    const { actorId } = request.params;
    
    try {
      const result = await ActorModel.deleteOne({ id: actorId });
      await ActorSourceModel.deleteMany({ actorId });
      
      return { 
        ok: result.deletedCount > 0, 
        message: result.deletedCount > 0 ? 'Actor deleted' : 'Actor not found'
      };
    } catch (err) {
      console.error('[Actors] Delete error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  /**
   * POST /api/actors/seed
   * Import all seed actors
   */
  fastify.post('/seed', async (request, reply) => {
    try {
      const actors = ACTORS_SEED.map(a => ({
        name: a.name,
        type: a.type as ActorType,
        addresses: a.addresses.filter(addr => !addr.startsWith('0x00000000')), // Skip placeholders
        source: a.source as SourceLevel,
        tags: a.tags,
      }));
      
      const result = await importActorsBatch(actors);
      
      // Recalculate coverage after import
      const coverageResult = await recalculateAllCoverage();
      
      return { 
        ok: true, 
        data: {
          import: result,
          coverage: coverageResult,
        },
        message: `Seeded ${result.created} new actors, updated ${result.updated}. Coverage recalculated for ${coverageResult.updated} actors.`
      };
    } catch (err) {
      console.error('[Actors] Seed error:', err);
      return reply.status(500).send({ ok: false, error: String(err) });
    }
  });
  
  console.log('[Actors Enrichment] Routes registered');
};

export default actorEnrichmentRoutes;
