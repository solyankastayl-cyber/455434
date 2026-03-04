/**
 * Route Intelligence v2.1 API Routes (P0.5)
 * 
 * REST API for enriched route analysis.
 */

import { FastifyInstance } from 'fastify';
import {
  RouteEnrichedModel,
  getRouteByIdV2,
  getRoutesByWalletV2,
  getHighRiskRoutesV2,
  getExitRoutesV2,
  getRouteStatsV2
} from '../storage/route_enriched.model.js';
import { analyzeWallet, analyzeWallets, parseTimeWindow } from '../route_analyze.service.js';

export default async function routesV21Routes(fastify: FastifyInstance) {
  
  // ========================================
  // Analysis Endpoints
  // ========================================
  
  /**
   * POST /api/routes/v2.1/analyze/:address
   * Analyze wallet and build enriched route
   */
  fastify.post('/routes/v2.1/analyze/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const query = request.query as {
        window?: '1h' | '6h' | '24h' | '7d';
        force?: string;
      };
      
      const result = await analyzeWallet(address, {
        window: query.window,
        forceRebuild: query.force === 'true'
      });
      
      if (!result) {
        return reply.code(404).send({
          ok: false,
          error: 'NO_ACTIVITY',
          message: `No activity found for ${address} in the specified window`
        });
      }
      
      return {
        ok: true,
        data: {
          routeId: result.routeId,
          isNew: result.isNew,
          route: {
            routeType: result.route.routeType,
            segmentsCount: result.route.segmentsCount,
            swapsCount: result.route.swapsCount,
            bridgesCount: result.route.bridgesCount,
            chains: result.route.chains,
            risk: result.route.risk,
            confidence: result.route.confidence,
            labels: result.route.labels,
            totalAmountUsd: result.route.totalAmountUsd
          },
          alerts: result.alerts
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error analyzing:', error);
      return reply.code(500).send({
        ok: false,
        error: 'ANALYZE_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/routes/v2.1/analyze/batch
   * Analyze multiple wallets
   */
  fastify.post('/routes/v2.1/analyze/batch', async (request, reply) => {
    try {
      const body = request.body as {
        wallets: string[];
        window?: '1h' | '6h' | '24h' | '7d';
      };
      
      if (!body.wallets || body.wallets.length === 0) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_INPUT',
          message: 'wallets array is required'
        });
      }
      
      if (body.wallets.length > 20) {
        return reply.code(400).send({
          ok: false,
          error: 'TOO_MANY_WALLETS',
          message: 'Maximum 20 wallets per batch'
        });
      }
      
      const results = await analyzeWallets(body.wallets, { window: body.window });
      
      const summary = {
        total: body.wallets.length,
        analyzed: 0,
        noActivity: 0,
        errors: 0
      };
      
      const routes: any[] = [];
      
      for (const [wallet, result] of results) {
        if (result) {
          summary.analyzed++;
          routes.push({
            wallet,
            routeId: result.routeId,
            routeType: result.route.routeType,
            risk: result.route.risk,
            alerts: result.alerts.length
          });
        } else {
          summary.noActivity++;
        }
      }
      
      return {
        ok: true,
        data: {
          summary,
          routes
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error batch analyzing:', error);
      return reply.code(500).send({
        ok: false,
        error: 'BATCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Query Endpoints
  // ========================================
  
  /**
   * GET /api/routes/v2.1
   * List routes with filtering
   */
  fastify.get('/routes/v2.1', async (request, reply) => {
    try {
      const query = request.query as {
        wallet?: string;
        minRisk?: string;
        type?: string;
        chain?: string;
        from?: string;
        to?: string;
        limit?: string;
        offset?: string;
      };
      
      const filter: any = {};
      
      if (query.wallet) filter.wallet = query.wallet.toLowerCase();
      if (query.minRisk) filter['risk.dumpRiskScore'] = { $gte: parseInt(query.minRisk) };
      if (query.type) filter.routeType = query.type;
      if (query.chain) filter.chains = query.chain;
      
      if (query.from) {
        filter.timeWindowStart = { $gte: new Date(query.from) };
      }
      if (query.to) {
        filter.timeWindowEnd = { $lte: new Date(query.to) };
      }
      
      const limit = Math.min(parseInt(query.limit || '50'), 100);
      const offset = parseInt(query.offset || '0');
      
      const routes = await RouteEnrichedModel.find(filter)
        .sort({ 'risk.dumpRiskScore': -1, createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .select('-segments')
        .lean();
      
      return {
        ok: true,
        data: {
          routes: routes.map(r => ({
            routeId: r.routeId,
            wallet: r.wallet,
            routeType: r.routeType,
            chains: r.chains,
            segmentsCount: r.segmentsCount,
            swapsCount: r.swapsCount,
            risk: r.risk,
            confidence: r.confidence,
            labels: r.labels,
            totalAmountUsd: r.totalAmountUsd,
            createdAt: r.createdAt
          })),
          count: routes.length,
          offset,
          limit
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error listing:', error);
      return reply.code(500).send({
        ok: false,
        error: 'LIST_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/v2.1/:routeId
   * Get route by ID with full segments
   */
  fastify.get('/routes/v2.1/:routeId', async (request, reply) => {
    try {
      const { routeId } = request.params as { routeId: string };
      
      const route = await getRouteByIdV2(routeId);
      
      if (!route) {
        return reply.code(404).send({
          ok: false,
          error: 'ROUTE_NOT_FOUND',
          message: `Route not found: ${routeId}`
        });
      }
      
      return {
        ok: true,
        data: route
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error fetching:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/v2.1/wallet/:address
   * Get routes for wallet
   */
  fastify.get('/routes/v2.1/wallet/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const query = request.query as {
        minRisk?: string;
        type?: string;
        limit?: string;
      };
      
      const routes = await getRoutesByWalletV2(address, {
        minRisk: query.minRisk ? parseInt(query.minRisk) : undefined,
        routeType: query.type as any,
        limit: query.limit ? parseInt(query.limit) : 50
      });
      
      return {
        ok: true,
        data: {
          wallet: address.toLowerCase(),
          routes: routes.map(r => ({
            routeId: r.routeId,
            routeType: r.routeType,
            chains: r.chains,
            risk: r.risk,
            confidence: r.confidence,
            totalAmountUsd: r.totalAmountUsd,
            createdAt: r.createdAt
          })),
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error fetching wallet routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Special Queries
  // ========================================
  
  /**
   * GET /api/routes/v2.1/exits
   * Get EXIT routes
   */
  fastify.get('/routes/v2.1/exits', async (request, reply) => {
    try {
      const query = request.query as {
        minProbability?: string;
        since?: string;
        limit?: string;
      };
      
      const routes = await getExitRoutesV2({
        minProbability: query.minProbability ? parseFloat(query.minProbability) : undefined,
        since: query.since ? new Date(query.since) : undefined,
        limit: query.limit ? parseInt(query.limit) : 50
      });
      
      return {
        ok: true,
        data: {
          exits: routes.map(r => ({
            routeId: r.routeId,
            wallet: r.wallet,
            endLabel: r.endLabel,
            risk: r.risk,
            chains: r.chains,
            totalAmountUsd: r.totalAmountUsd,
            createdAt: r.createdAt
          })),
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error fetching exits:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/v2.1/high-risk
   * Get high-risk routes
   */
  fastify.get('/routes/v2.1/high-risk', async (request, reply) => {
    try {
      const query = request.query as {
        minRisk?: string;
        limit?: string;
      };
      
      const routes = await getHighRiskRoutesV2(
        query.minRisk ? parseInt(query.minRisk) : 80,
        query.limit ? parseInt(query.limit) : 50
      );
      
      return {
        ok: true,
        data: {
          highRisk: routes.map(r => ({
            routeId: r.routeId,
            wallet: r.wallet,
            routeType: r.routeType,
            risk: r.risk,
            labels: r.labels,
            chains: r.chains,
            totalAmountUsd: r.totalAmountUsd,
            createdAt: r.createdAt
          })),
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error fetching high-risk:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Stats
  // ========================================
  
  /**
   * GET /api/routes/v2.1/stats
   * Get route statistics
   */
  fastify.get('/routes/v2.1/stats', async (request, reply) => {
    try {
      const stats = await getRouteStatsV2();
      
      return {
        ok: true,
        data: stats
      };
    } catch (error: any) {
      fastify.log.error('[Routes v2.1] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Routes v2.1] Routes registered');
}
