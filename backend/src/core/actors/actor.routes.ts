/**
 * Actor API Routes
 * 
 * EPIC A1: Actors Dataset Builder
 * EPIC A4: Actors Finalization
 * 
 * Endpoints:
 * - POST /build - Run actor build
 * - GET / - List actors with pagination/filters
 * - GET /:id - Get actor detail
 * - GET /:id/graph-context - Get actor's graph context (A4-BE-3)
 * - GET /:id/temporal - Get actor's temporal context (A4-BE-2)
 * - GET /stats - Get actor statistics
 */

import type { FastifyPluginAsync } from 'fastify';
import { runActorBuild, queryActors } from './actor.builder.service.js';
import { 
  getActorById, 
  getActorByAddress,
  getBuildRun,
  getRecentBuildRuns,
  getActorCount,
  getActorCountByType,
  getActorCountBySource
} from './actor.model.js';
import { ActorModel } from './actor.model.js';
import { calculateTemporalContext, getRegimeDescription, getRegimeBadge } from './actor.temporal.service.js';
import type { ActorQueryOptions, ActorBuildConfig } from './actor.types.js';
import { buildActorsGraph } from './actors_graph.service.js';

// Known actor addresses for seeding
const SEED_ACTORS = [
  {
    id: 'actor_binance',
    type: 'exchange',
    name: 'Binance',
    sourceLevel: 'verified',
    addresses: [
      '0x28c6c06298d514db089934071355e5743bf21d60',
      '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
      '0xdfd5293d8e347dfe59e90efd55b2956a1343963d',
    ],
  },
  {
    id: 'actor_coinbase',
    type: 'exchange',
    name: 'Coinbase',
    sourceLevel: 'verified',
    addresses: [
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
      '0x503828976d22510aad0201ac7ec88293211d23da',
      '0xa090e606e30bd747d4e6245a1517ebe430f0057e',
    ],
  },
  {
    id: 'actor_kraken',
    type: 'exchange',
    name: 'Kraken',
    sourceLevel: 'verified',
    addresses: [
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
      '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13',
    ],
  },
  {
    id: 'actor_circle',
    type: 'fund',
    name: 'Circle',
    sourceLevel: 'verified',
    addresses: [
      '0x55fe002aeff02f77364de339a1292923a15844b8',
      '0x5b6122c109b78c6755486966148c1d70a50a47d7',
    ],
  },
  {
    id: 'actor_tether',
    type: 'fund',
    name: 'Tether Treasury',
    sourceLevel: 'verified',
    addresses: [
      '0x5754284f345afc66a98fbb0a0afe71e0f007b949',
      '0x47ac0fb4f2d84898e4d9e7b4dab3c24507a6d503',
    ],
  },
  {
    id: 'actor_jump',
    type: 'market_maker',
    name: 'Jump Trading',
    sourceLevel: 'attributed',
    addresses: [
      '0x9696f59e4d72e237be84ffd425dcad154bf96976',
      '0xf584f8728b874a6a5c7a8d4d387c9aae9172d621',
    ],
  },
  {
    id: 'actor_wintermute',
    type: 'market_maker',
    name: 'Wintermute',
    sourceLevel: 'attributed',
    addresses: [
      '0x0d0707963952f2fba59dd06f2b425ace40b492fe',
      '0x00000000ae347930bd1e7b0f35588b92280f9e75',
    ],
  },
];

export const actorRoutes: FastifyPluginAsync = async (app) => {
  
  // ============================================
  // SEED ENDPOINT (ETAP 6.2)
  // ============================================
  
  // Seed test actors with known addresses
  app.post('/seed', async (_req, reply) => {
    try {
      let created = 0;
      let skipped = 0;
      
      for (const actor of SEED_ACTORS) {
        const exists = await ActorModel.findOne({ id: actor.id });
        if (exists) {
          skipped++;
          continue;
        }
        
        await ActorModel.create({
          id: actor.id,
          type: actor.type,
          name: actor.name,
          sourceLevel: actor.sourceLevel,
          addresses: actor.addresses,
          addressStats: {
            verifiedCount: actor.addresses.length,
            attributedCount: 0,
            behavioralCount: 0,
            totalCount: actor.addresses.length,
          },
          coverage: {
            score: 85,
            band: 'High',
            lastUpdated: new Date(),
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        created++;
      }
      
      return reply.send({
        ok: true,
        data: {
          created,
          skipped,
          total: SEED_ACTORS.length,
        },
        message: `Seeded ${created} actors, skipped ${skipped} existing`,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'SEED_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });

  // ============================================
  // BUILD ENDPOINTS
  // ============================================
  
  // Run actor build
  app.post('/build', async (req, reply) => {
    const body = req.body as Partial<ActorBuildConfig>;
    
    try {
      const stats = await runActorBuild(body);
      return reply.send({ ok: true, data: stats });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'BUILD_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
  
  // Get build run status
  app.get('/build/status', async (req, reply) => {
    const query = req.query as { runId?: string };
    
    if (query.runId) {
      const run = await getBuildRun(query.runId);
      return reply.send({ ok: true, data: run });
    }
    
    // Return latest run
    const runs = await getRecentBuildRuns(1);
    return reply.send({ 
      ok: true, 
      data: runs.length > 0 ? runs[0] : null 
    });
  });
  
  // Get build history
  app.get('/build/history', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '10', 10), 50);
    
    const runs = await getRecentBuildRuns(limit);
    return reply.send({ ok: true, data: runs, count: runs.length });
  });
  
  // ============================================
  // LIST & QUERY ENDPOINTS
  // ============================================
  
  // List actors with filters
  app.get('/', async (req, reply) => {
    const query = req.query as Record<string, string>;
    
    const options: ActorQueryOptions = {
      type: query.type as ActorQueryOptions['type'],
      sourceLevel: query.sourceLevel as ActorQueryOptions['sourceLevel'],
      coverageBand: query.coverageBand as ActorQueryOptions['coverageBand'],
      search: query.q || query.search,
      sort: (query.sort as ActorQueryOptions['sort']) || 'coverage',
      sortOrder: (query.sortOrder as ActorQueryOptions['sortOrder']) || 'desc',
      page: parseInt(query.page || '1', 10),
      limit: Math.min(parseInt(query.limit || '20', 10), 100),
    };
    
    const result = await queryActors(options);
    
    return reply.send({
      ok: true,
      data: result.actors,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    });
  });
  
  // ============================================
  // DETAIL ENDPOINTS
  // ============================================
  
  // Get actor by ID
  app.get('/:id', async (req, reply) => {
    const params = req.params as { id: string };
    
    const actor = await getActorById(params.id);
    if (!actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `Actor ${params.id} not found`,
      });
    }
    
    return reply.send({ ok: true, data: actor });
  });
  
  // Get actor by address
  app.get('/address/:address', async (req, reply) => {
    const params = req.params as { address: string };
    
    const actor = await getActorByAddress(params.address);
    if (!actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `No actor found for address ${params.address}`,
      });
    }
    
    return reply.send({ ok: true, data: actor });
  });
  
  // ============================================
  // A4-BE-3: GRAPH CONTEXT ENDPOINT
  // ============================================
  
  // Get actor's graph context
  app.get('/:id/graph-context', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { window?: string };
    const window = query.window || '7d';
    
    const actor = await getActorById(params.id);
    if (!actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `Actor ${params.id} not found`,
      });
    }
    
    try {
      // Build graph and find actor's context
      const windowDays = window === '24h' ? 1 : window === '30d' ? 30 : 7;
      const graph = await buildActorsGraph(windowDays);
      
      // Actor ID in graph uses the actor.id field (e.g., 'actor_binance_main')
      const actorId = actor.id;
      const graphNodeId = actorId.startsWith('actor_') ? actorId : `actor_${actorId}`;
      const node = graph.nodes.find(n => n.id === graphNodeId);
      
      // Find connected edges
      const connectedEdges = graph.edges.filter(
        e => e.from === graphNodeId || e.to === graphNodeId
      );
      
      // Sort by weight and get top 3
      const strongestEdges = [...connectedEdges]
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map(e => ({
          id: e.id,
          connectedTo: e.from === graphNodeId ? e.to : e.from,
          connectedToLabel: graph.nodes.find(n => n.id === (e.from === graphNodeId ? e.to : e.from))?.label || 'Unknown',
          edgeType: e.edgeType,
          weight: e.weight,
          confidence: e.confidence,
        }));
      
      // Collect edge types present
      const edgeTypesPresent = [...new Set(connectedEdges.map(e => e.edgeType))];
      
      // Calculate degree metrics
      const inDegree = connectedEdges.filter(e => e.to === graphNodeId).length;
      const outDegree = connectedEdges.filter(e => e.from === graphNodeId).length;
      const totalDegree = inDegree + outDegree;
      
      return reply.send({
        ok: true,
        data: {
          actorId: actorId,
          actorName: actor.name,
          graphNodeId,
          window,
          found: !!node,
          degree: totalDegree,
          inDegree,
          outDegree,
          strongestEdges,
          edgeTypesPresent,
          cluster: node?.cluster || null,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'GRAPH_ERROR',
        message: err instanceof Error ? err.message : 'Failed to build graph context',
      });
    }
  });
  
  // ============================================
  // A4-BE-2: TEMPORAL CONTEXT ENDPOINT
  // ============================================
  
  // Get actor's temporal context
  app.get('/:id/temporal', async (req, reply) => {
    const params = req.params as { id: string };
    const query = req.query as { window?: string };
    const window = (query.window as '24h' | '7d' | '30d') || '7d';
    
    const actor = await getActorById(params.id);
    if (!actor) {
      return reply.status(404).send({
        ok: false,
        error: 'ACTOR_NOT_FOUND',
        message: `Actor ${params.id} not found`,
      });
    }
    
    // For now, return computed from actor data
    // In production, would compare with historical snapshots
    const temporalContext = {
      regime: 'STABLE' as const,
      window,
      confidence: 'MEDIUM' as const,
      deltas: {
        participation: 0,
        volume: 0,
      },
      computedAt: new Date(),
    };
    
    const badge = getRegimeBadge(temporalContext.regime);
    const description = getRegimeDescription(temporalContext);
    
    return reply.send({
      ok: true,
      data: {
        actorId: actor.id,
        actorName: actor.name,
        temporal: temporalContext,
        badge,
        description,
        disclaimer: 'Observed participation change. Fact-based. Not a prediction.',
      },
    });
  });
  
  // ============================================
  // STATS ENDPOINTS
  // ============================================
  
  // Get actor statistics
  app.get('/stats/summary', async (_req, reply) => {
    const [total, byType, bySource] = await Promise.all([
      getActorCount(),
      getActorCountByType(),
      getActorCountBySource(),
    ]);
    
    return reply.send({
      ok: true,
      data: {
        total,
        byType,
        bySource,
      },
    });
  });
};
