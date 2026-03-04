/**
 * P3.3 KNG Topology Routes
 * 
 * API endpoints for topology analysis:
 * - GET /api/v2/topology/actors - Actor ranking
 * - GET /api/v2/topology/market - Market topology
 * - GET /api/v2/topology/features/market - ML features (flat)
 * - GET /api/v2/topology/features/actors - Actor features for ML
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import mongoose from 'mongoose';
import { TopologyActorService } from './topology_actor.service.js';
import { TopologyMarketService } from './topology_market.service.js';
import { TOPOLOGY_CONFIG } from './topology.config.js';
import type { TopologyWindow, TopologySortField } from './topology.types.js';

// ============================================
// REQUEST TYPES
// ============================================

interface ActorTopologyQuery {
  network: string;
  window?: TopologyWindow;
  sort?: TopologySortField;
  limit?: number;
}

interface MarketTopologyQuery {
  network: string;
  window?: TopologyWindow;
}

interface ActorFeaturesQuery {
  network: string;
  window?: TopologyWindow;
  actorId?: string;
  limit?: number;
}

// ============================================
// ROUTES
// ============================================

export async function topologyRoutes(app: FastifyInstance): Promise<void> {
  const db = mongoose.connection.db;
  const actorService = new TopologyActorService(db);
  const marketService = new TopologyMarketService(db);

  // ============================================
  // ACTOR TOPOLOGY (ranking)
  // ============================================

  /**
   * GET /actors
   * Get top actors ranked by topology metrics
   */
  app.get('/actors', async (
    request: FastifyRequest<{ Querystring: ActorTopologyQuery }>,
    reply: FastifyReply
  ) => {
    const { 
      network, 
      window = '24h', 
      sort = 'pagerank',
      limit = 100 
    } = request.query;

    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network parameter is required',
      });
    }

    // Validate sort field
    const allowedSort = TOPOLOGY_CONFIG.allowedSort as readonly string[];
    if (!allowedSort.includes(sort)) {
      return reply.code(400).send({
        ok: false,
        error: 'INVALID_SORT',
        message: `sort must be one of: ${allowedSort.join(', ')}`,
      });
    }

    try {
      const actors = await actorService.getTop(
        network,
        window as TopologyWindow,
        sort,
        Math.min(500, limit)
      );

      return reply.send({
        ok: true,
        data: {
          network,
          window,
          sortBy: sort,
          count: actors.length,
          items: actors,
        },
      });
    } catch (error: any) {
      app.log.error(`[P3.3] Actor topology failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'TOPOLOGY_FAILED',
        message: error.message,
      });
    }
  });

  // ============================================
  // MARKET TOPOLOGY
  // ============================================

  /**
   * GET /market
   * Get market-level topology metrics
   */
  app.get('/market', async (
    request: FastifyRequest<{ Querystring: MarketTopologyQuery }>,
    reply: FastifyReply
  ) => {
    const { network, window = '24h' } = request.query;

    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network parameter is required',
      });
    }

    try {
      const tsBucket = Math.floor(Date.now() / 1000);
      const market = await marketService.compute(network, window as TopologyWindow, tsBucket);

      return reply.send({
        ok: true,
        data: market,
      });
    } catch (error: any) {
      app.log.error(`[P3.3] Market topology failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'TOPOLOGY_FAILED',
        message: error.message,
      });
    }
  });

  // ============================================
  // ML FEATURE ENDPOINTS (flat, no addresses)
  // ============================================

  /**
   * GET /features/market
   * Get flat market topology features for ML
   */
  app.get('/features/market', async (
    request: FastifyRequest<{ Querystring: MarketTopologyQuery }>,
    reply: FastifyReply
  ) => {
    const { network, window = '24h' } = request.query;

    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network parameter is required',
      });
    }

    try {
      const features = await marketService.getFeatures(network, window as TopologyWindow);

      return reply.send({
        ok: true,
        data: features,
      });
    } catch (error: any) {
      app.log.error(`[P3.3] Market features failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'FEATURES_FAILED',
        message: error.message,
      });
    }
  });

  /**
   * GET /features/actors
   * Get actor topology features for ML
   */
  app.get('/features/actors', async (
    request: FastifyRequest<{ Querystring: ActorFeaturesQuery }>,
    reply: FastifyReply
  ) => {
    const { 
      network, 
      window = '24h',
      actorId,
      limit = 100 
    } = request.query;

    if (!network) {
      return reply.code(400).send({
        ok: false,
        error: 'NETWORK_REQUIRED',
        message: 'network parameter is required',
      });
    }

    try {
      const tsBucket = Math.floor(Date.now() / 1000);
      let actors = await actorService.compute(network, window as TopologyWindow, tsBucket);

      // Filter by actorId if provided
      if (actorId) {
        const normalized = actorId.toLowerCase();
        actors = actors.filter(a => a.address === normalized);
      }

      // Transform to flat features (remove address from list view)
      const features = actors.slice(0, limit).map(a => ({
        actorId: a.address,
        network: a.network,
        window: a.window,
        tsBucket: a.tsBucket,
        degIn: a.degIn,
        degOut: a.degOut,
        wInUsd: a.wInUsd,
        wOutUsd: a.wOutUsd,
        netFlowUsd: a.netFlowUsd,
        entropyOut: a.entropyOut,
        hubScore: a.hubScore,
        pagerank: a.pagerank,
        kCore: a.kCore,
        brokerScore: a.brokerScore,
        roleHint: a.roleHint,
      }));

      return reply.send({
        ok: true,
        data: {
          network,
          window,
          count: features.length,
          features,
        },
      });
    } catch (error: any) {
      app.log.error(`[P3.3] Actor features failed: ${error.message}`);
      return reply.code(500).send({
        ok: false,
        error: 'FEATURES_FAILED',
        message: error.message,
      });
    }
  });

  // ============================================
  // ALL NETWORKS
  // ============================================

  /**
   * GET /market/all
   * Get market topology for all networks
   */
  app.get('/market/all', async (
    request: FastifyRequest<{ Querystring: { window?: string } }>,
    reply: FastifyReply
  ) => {
    const { window = '24h' } = request.query;
    const networks = ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'bnb', 'zksync', 'scroll'];

    try {
      const tsBucket = Math.floor(Date.now() / 1000);
      const results: Record<string, any> = {};

      for (const network of networks) {
        results[network] = await marketService.compute(network, window as TopologyWindow, tsBucket);
      }

      return reply.send({
        ok: true,
        data: results,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'TOPOLOGY_FAILED',
        message: error.message,
      });
    }
  });

  app.log.info('[P3.3] KNG Topology routes registered');
}

export default topologyRoutes;
