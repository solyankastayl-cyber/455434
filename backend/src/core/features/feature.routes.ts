/**
 * P2.1 Feature Store - API Routes
 * 
 * Read-only API for feature retrieval
 * Used by ML, Twitter, Ranking systems
 * 
 * Base path: /api/v2/features
 */

import type { FastifyInstance } from 'fastify';
import { SUPPORTED_NETWORKS, normalizeNetwork } from '../../common/network.types.js';
import { 
  FeatureActorModel, 
  FeatureMarketModel, 
  FeatureCorridorModel,
  toBucket 
} from './feature.models.js';
import { runActorFeatureBuilder } from './actor_feature.builder.js';
import { runMarketFeatureBuilder } from './market_feature.builder.js';
import { runCorridorFeatureBuilder } from './corridor_feature.builder.js';

// ============================================
// ROUTES
// ============================================

export async function featureRoutes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/v2/features/actor - Get actor features
   */
  app.get('/actor', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required. Supported: ${SUPPORTED_NETWORKS.join(', ')}`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const actorId = query.actorId?.toLowerCase();
    const fromTs = query.fromTs ? parseInt(query.fromTs, 10) : undefined;
    const toTs = query.toTs ? parseInt(query.toTs, 10) : undefined;
    const limit = Math.min(parseInt(query.limit || '200', 10), 1000);
    
    // Build query
    const mongoQuery: Record<string, any> = { network };
    
    if (actorId) {
      mongoQuery.actorId = actorId;
    }
    
    if (fromTs || toTs) {
      mongoQuery.bucketTs = {};
      if (fromTs) mongoQuery.bucketTs.$gte = fromTs;
      if (toTs) mongoQuery.bucketTs.$lte = toTs;
    }
    
    const features = await FeatureActorModel
      .find(mongoQuery)
      .sort({ bucketTs: -1 })
      .limit(limit)
      .lean();
    
    // Clean _id from response
    const cleaned = features.map(f => {
      const { _id, ...rest } = f as any;
      return rest;
    });
    
    return {
      ok: true,
      data: {
        features: cleaned,
        count: cleaned.length,
        meta: {
          network,
          actorId: actorId || 'all',
          version: 'P2.1.0',
        },
      },
    };
  });

  /**
   * GET /api/v2/features/actor/:actorId - Get specific actor features
   */
  app.get('/actor/:actorId', async (request, reply) => {
    const params = request.params as { actorId: string };
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const actorId = params.actorId.toLowerCase();
    
    // Get latest feature
    const feature = await FeatureActorModel
      .findOne({ network, actorId })
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!feature) {
      return reply.status(404).send({
        ok: false,
        error: 'FEATURE_NOT_FOUND',
        message: `No features found for actor ${actorId} on ${network}`,
      });
    }
    
    const { _id, ...rest } = feature as any;
    
    return {
      ok: true,
      data: rest,
    };
  });

  /**
   * GET /api/v2/features/market - Get market features
   */
  app.get('/market', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const fromTs = query.fromTs ? parseInt(query.fromTs, 10) : undefined;
    const toTs = query.toTs ? parseInt(query.toTs, 10) : undefined;
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const mongoQuery: Record<string, any> = { network };
    
    if (fromTs || toTs) {
      mongoQuery.bucketTs = {};
      if (fromTs) mongoQuery.bucketTs.$gte = fromTs;
      if (toTs) mongoQuery.bucketTs.$lte = toTs;
    }
    
    const features = await FeatureMarketModel
      .find(mongoQuery)
      .sort({ bucketTs: -1 })
      .limit(limit)
      .lean();
    
    const cleaned = features.map(f => {
      const { _id, ...rest } = f as any;
      return rest;
    });
    
    return {
      ok: true,
      data: {
        features: cleaned,
        count: cleaned.length,
        meta: {
          network,
          version: 'P2.1.0',
        },
      },
    };
  });

  /**
   * GET /api/v2/features/market/latest - Get latest market feature
   */
  app.get('/market/latest', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const feature = await FeatureMarketModel
      .findOne({ network })
      .sort({ bucketTs: -1 })
      .lean();
    
    if (!feature) {
      return reply.status(404).send({
        ok: false,
        error: 'FEATURE_NOT_FOUND',
        message: `No market features found for ${network}`,
      });
    }
    
    const { _id, ...rest } = feature as any;
    
    return {
      ok: true,
      data: rest,
    };
  });

  /**
   * GET /api/v2/features/corridors - Get corridor features
   */
  app.get('/corridors', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    if (!query.network) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: `Network parameter is required.`,
      });
    }
    
    let network: string;
    try {
      network = normalizeNetwork(query.network);
    } catch (e) {
      return reply.status(400).send({
        ok: false,
        error: 'NETWORK_INVALID',
        message: `Invalid network.`,
      });
    }
    
    const corridorKey = query.corridorKey;
    const fromTs = query.fromTs ? parseInt(query.fromTs, 10) : undefined;
    const toTs = query.toTs ? parseInt(query.toTs, 10) : undefined;
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const mongoQuery: Record<string, any> = { network };
    
    if (corridorKey) {
      mongoQuery.corridorKey = corridorKey;
    }
    
    if (fromTs || toTs) {
      mongoQuery.bucketTs = {};
      if (fromTs) mongoQuery.bucketTs.$gte = fromTs;
      if (toTs) mongoQuery.bucketTs.$lte = toTs;
    }
    
    const features = await FeatureCorridorModel
      .find(mongoQuery)
      .sort({ bucketTs: -1 })
      .limit(limit)
      .lean();
    
    const cleaned = features.map(f => {
      const { _id, ...rest } = f as any;
      return rest;
    });
    
    return {
      ok: true,
      data: {
        features: cleaned,
        count: cleaned.length,
        meta: {
          network,
          version: 'P2.1.0',
        },
      },
    };
  });

  /**
   * POST /api/v2/features/build - Trigger feature build (admin)
   */
  app.post('/build', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const builderType = body.type || 'all';
    
    const results: Record<string, any> = {};
    
    try {
      if (builderType === 'all' || builderType === 'market') {
        console.log('[P2.1] Running Market Feature Builder...');
        results.market = await runMarketFeatureBuilder();
      }
      
      if (builderType === 'all' || builderType === 'actor') {
        console.log('[P2.1] Running Actor Feature Builder...');
        results.actor = await runActorFeatureBuilder();
      }
      
      if (builderType === 'all' || builderType === 'corridor') {
        console.log('[P2.1] Running Corridor Feature Builder...');
        results.corridor = await runCorridorFeatureBuilder();
      }
      
      return {
        ok: true,
        data: {
          builderType,
          results,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: 'BUILD_FAILED',
        message: err.message,
      });
    }
  });

  /**
   * GET /api/v2/features/stats - Feature store statistics
   */
  app.get('/stats', async (request, reply) => {
    const query = request.query as Record<string, string>;
    
    const network = query.network ? normalizeNetwork(query.network) : null;
    
    const matchStage = network ? { network } : {};
    
    const [actorStats, marketStats, corridorStats] = await Promise.all([
      FeatureActorModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$network',
            count: { $sum: 1 },
            latestBucket: { $max: '$bucketTs' },
            uniqueActors: { $addToSet: '$actorId' },
          },
        },
      ]),
      FeatureMarketModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$network',
            count: { $sum: 1 },
            latestBucket: { $max: '$bucketTs' },
          },
        },
      ]),
      FeatureCorridorModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$network',
            count: { $sum: 1 },
            latestBucket: { $max: '$bucketTs' },
            uniqueCorridors: { $addToSet: '$corridorKey' },
          },
        },
      ]),
    ]);
    
    return {
      ok: true,
      data: {
        actor: actorStats.map(s => ({
          network: s._id,
          featureCount: s.count,
          uniqueActors: s.uniqueActors?.length || 0,
          latestBucket: s.latestBucket,
          latestDate: s.latestBucket ? new Date(s.latestBucket * 1000).toISOString() : null,
        })),
        market: marketStats.map(s => ({
          network: s._id,
          featureCount: s.count,
          latestBucket: s.latestBucket,
          latestDate: s.latestBucket ? new Date(s.latestBucket * 1000).toISOString() : null,
        })),
        corridor: corridorStats.map(s => ({
          network: s._id,
          featureCount: s.count,
          uniqueCorridors: s.uniqueCorridors?.length || 0,
          latestBucket: s.latestBucket,
          latestDate: s.latestBucket ? new Date(s.latestBucket * 1000).toISOString() : null,
        })),
        version: 'P2.1.0',
      },
    };
  });

  app.log.info('[P2.1] Feature Store routes registered');
}

export default featureRoutes;
