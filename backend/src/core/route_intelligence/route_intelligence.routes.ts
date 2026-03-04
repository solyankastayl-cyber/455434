/**
 * Route Intelligence API Routes (P0.3)
 * 
 * REST API for liquidity route intelligence.
 */

import { FastifyInstance } from 'fastify';
import {
  getRoutes,
  getRouteWithSegments,
  getRoutesByWallet,
  getExitRoutes,
  getRouteStats,
  buildRoutesFromRecentEvents,
  rebuildWalletRoutes,
  analyzeWalletForDumps,
  getHighRiskRoutes,
  seedTestRoutes,
  RouteQueryOptions
} from './route_intelligence.service.js';
import { LiquidityRouteModel } from './liquidity_route.model.js';
import { RouteSegmentModel } from './route_segment.model.js';
import { recomputeRouteMetrics } from './route_builder.service.js';

export default async function routeIntelligenceRoutes(fastify: FastifyInstance) {
  
  // ========================================
  // Route Query Endpoints
  // ========================================
  
  /**
   * GET /api/routes
   * List routes with filtering
   */
  fastify.get('/routes', async (request, reply) => {
    try {
      const query = request.query as {
        type?: string;
        status?: string;
        minConfidence?: string;
        chain?: string;
        wallet?: string;
        actorId?: string;
        endLabel?: string;
        startDate?: string;
        endDate?: string;
        limit?: string;
        offset?: string;
        sortBy?: string;
        sortOrder?: string;
      };
      
      const options: RouteQueryOptions = {
        routeType: query.type?.split(',') as any,
        status: query.status?.split(',') as any,
        minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
        chain: query.chain,
        wallet: query.wallet,
        actorId: query.actorId,
        endLabel: query.endLabel,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        limit: query.limit ? parseInt(query.limit) : 100,
        offset: query.offset ? parseInt(query.offset) : 0,
        sortBy: query.sortBy as any,
        sortOrder: query.sortOrder as any
      };
      
      const routes = await getRoutes(options);
      
      return {
        ok: true,
        data: {
          routes,
          count: routes.length,
          offset: options.offset,
          limit: options.limit
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error listing routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'LIST_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/:routeId
   * Get route by ID with segments
   */
  fastify.get('/routes/:routeId', async (request, reply) => {
    try {
      const { routeId } = request.params as { routeId: string };
      
      const result = await getRouteWithSegments(routeId);
      
      if (!result) {
        return reply.code(404).send({
          ok: false,
          error: 'ROUTE_NOT_FOUND',
          message: `Route not found: ${routeId}`
        });
      }
      
      return {
        ok: true,
        data: result
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching route:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/wallet/:address
   * Get routes by wallet address
   */
  fastify.get('/routes/wallet/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      const { includeSegments, limit } = request.query as { 
        includeSegments?: string;
        limit?: string;
      };
      
      const routes = await getRoutesByWallet(address, {
        includeSegments: includeSegments === 'true',
        limit: limit ? parseInt(limit) : 50
      });
      
      return {
        ok: true,
        data: {
          wallet: address.toLowerCase(),
          routes,
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching wallet routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/exits
   * Get EXIT routes (potential dumps)
   */
  fastify.get('/routes/exits', async (request, reply) => {
    try {
      const query = request.query as {
        minConfidence?: string;
        minAmountUsd?: string;
        exchange?: string;
        since?: string;
        limit?: string;
      };
      
      const routes = await getExitRoutes({
        minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : undefined,
        minAmountUsd: query.minAmountUsd ? parseFloat(query.minAmountUsd) : undefined,
        exchange: query.exchange,
        since: query.since ? new Date(query.since) : undefined,
        limit: query.limit ? parseInt(query.limit) : 50
      });
      
      return {
        ok: true,
        data: {
          exits: routes,
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching exit routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * GET /api/routes/high-risk
   * Get high-risk routes (potential dumps)
   */
  fastify.get('/routes/high-risk', async (request, reply) => {
    try {
      const query = request.query as {
        minConfidence?: string;
        minAmountUsd?: string;
        limit?: string;
      };
      
      const routes = await getHighRiskRoutes({
        minConfidence: query.minConfidence ? parseFloat(query.minConfidence) : 0.6,
        minAmountUsd: query.minAmountUsd ? parseFloat(query.minAmountUsd) : 10000,
        limit: query.limit ? parseInt(query.limit) : 20
      });
      
      return {
        ok: true,
        data: {
          highRiskRoutes: routes,
          count: routes.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching high-risk routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Statistics
  // ========================================
  
  /**
   * GET /api/routes/stats
   * Get route statistics
   */
  fastify.get('/routes/stats', async (request, reply) => {
    try {
      const stats = await getRouteStats();
      
      return {
        ok: true,
        data: stats
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching stats:', error);
      return reply.code(500).send({
        ok: false,
        error: 'STATS_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Analysis Endpoints
  // ========================================
  
  /**
   * GET /api/routes/analyze/:address
   * Analyze wallet for dump patterns
   */
  fastify.get('/routes/analyze/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      
      const analysis = await analyzeWalletForDumps(address);
      
      return {
        ok: true,
        data: {
          wallet: address.toLowerCase(),
          ...analysis
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error analyzing wallet:', error);
      return reply.code(500).send({
        ok: false,
        error: 'ANALYSIS_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Build & Recompute Endpoints
  // ========================================
  
  /**
   * POST /api/routes/build
   * Build routes from recent chain events
   */
  fastify.post('/routes/build', async (request, reply) => {
    try {
      const body = request.body as {
        chain?: string;
        since?: string;
        limit?: number;
      } || {};
      
      const result = await buildRoutesFromRecentEvents({
        chain: body.chain,
        since: body.since ? new Date(body.since) : undefined,
        limit: body.limit
      });
      
      return {
        ok: true,
        data: result,
        message: `Built ${result.routesCreated} new routes, updated ${result.routesUpdated}`
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error building routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'BUILD_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/routes/rebuild/:address
   * Rebuild routes for specific wallet
   */
  fastify.post('/routes/rebuild/:address', async (request, reply) => {
    try {
      const { address } = request.params as { address: string };
      
      const result = await rebuildWalletRoutes(address);
      
      return {
        ok: true,
        data: result,
        message: `Rebuilt routes for ${address}`
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error rebuilding wallet routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'REBUILD_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * POST /api/routes/recompute
   * Recompute route metrics
   */
  fastify.post('/routes/recompute', async (request, reply) => {
    try {
      const body = request.body as { routeIds?: string[] } || {};
      
      const updated = await recomputeRouteMetrics(body.routeIds);
      
      return {
        ok: true,
        data: { updated },
        message: `Recomputed ${updated} routes`
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error recomputing routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'RECOMPUTE_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Segments Endpoints
  // ========================================
  
  /**
   * GET /api/routes/:routeId/segments
   * Get segments for a route
   */
  fastify.get('/routes/:routeId/segments', async (request, reply) => {
    try {
      const { routeId } = request.params as { routeId: string };
      
      const segments = await RouteSegmentModel.find({ routeId })
        .sort({ index: 1 })
        .lean();
      
      return {
        ok: true,
        data: {
          routeId,
          segments,
          count: segments.length
        }
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error fetching segments:', error);
      return reply.code(500).send({
        ok: false,
        error: 'FETCH_ERROR',
        message: error.message
      });
    }
  });
  
  // ========================================
  // Admin Endpoints
  // ========================================
  
  /**
   * POST /api/routes/seed
   * Seed test data
   */
  fastify.post('/routes/seed', async (request, reply) => {
    try {
      const result = await seedTestRoutes();
      
      return {
        ok: true,
        data: result,
        message: `Seeded ${result.routes} routes and ${result.segments} segments`
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error seeding routes:', error);
      return reply.code(500).send({
        ok: false,
        error: 'SEED_ERROR',
        message: error.message
      });
    }
  });
  
  /**
   * DELETE /api/routes/:routeId
   * Delete a route
   */
  fastify.delete('/routes/:routeId', async (request, reply) => {
    try {
      const { routeId } = request.params as { routeId: string };
      
      const route = await LiquidityRouteModel.findOne({ routeId });
      
      if (!route) {
        return reply.code(404).send({
          ok: false,
          error: 'ROUTE_NOT_FOUND',
          message: `Route not found: ${routeId}`
        });
      }
      
      await Promise.all([
        LiquidityRouteModel.deleteOne({ routeId }),
        RouteSegmentModel.deleteMany({ routeId })
      ]);
      
      return {
        ok: true,
        message: `Deleted route ${routeId}`
      };
    } catch (error: any) {
      fastify.log.error('[RouteIntelligence] Error deleting route:', error);
      return reply.code(500).send({
        ok: false,
        error: 'DELETE_ERROR',
        message: error.message
      });
    }
  });
  
  fastify.log.info('[Route Intelligence] Routes registered');
}
