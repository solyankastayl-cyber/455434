/**
 * Market Route Correlation API (P1.6)
 * 
 * REST endpoints for route-market context integration.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  RouteMarketContextModel,
  getContextByRouteId,
  getHighRiskContexts,
  getRecentContexts
} from '../storage/route_market_context.model.js';
import { routeContextBuilder, RouteData } from '../context/route_context_builder.service.js';
import { marketRouteFeatureProvider } from '../features/market_route_features.provider.js';

// ============================================
// Routes
// ============================================

export async function marketRouteRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ========================================
  // GET /context/:routeId
  // ========================================
  fastify.get<{
    Params: { routeId: string };
  }>('/context/:routeId', async (request, reply) => {
    const { routeId } = request.params;
    
    const context = await getContextByRouteId(routeId);
    
    if (!context) {
      return reply.status(404).send({
        ok: false,
        error: 'Context not found for route'
      });
    }
    
    return {
      ok: true,
      context: {
        routeId: context.routeId,
        token: context.token,
        timeWindow: context.timeWindow,
        marketSnapshot: context.marketSnapshot,
        contextualRisk: context.contextualRisk,
        sourceQuality: context.sourceQuality,
        resolvedAt: context.resolvedAt
      }
    };
  });
  
  // ========================================
  // GET /high-risk
  // ========================================
  fastify.get<{
    Querystring: { minScore?: string; limit?: string };
  }>('/high-risk', async (request, reply) => {
    const minScore = parseInt(request.query.minScore || '70');
    const limit = parseInt(request.query.limit || '50');
    
    const contexts = await getHighRiskContexts(minScore, limit);
    
    return {
      ok: true,
      count: contexts.length,
      minScore,
      contexts: contexts.map(c => ({
        routeId: c.routeId,
        token: c.token,
        contextualRisk: c.contextualRisk,
        marketSnapshot: c.marketSnapshot ? {
          volatilityRegime: c.marketSnapshot.volatilityRegime,
          liquidityRegime: c.marketSnapshot.liquidityRegime,
          isStressed: c.marketSnapshot.isStressed
        } : null,
        resolvedAt: c.resolvedAt
      }))
    };
  });
  
  // ========================================
  // GET /stats
  // ========================================
  fastify.get('/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const total = await RouteMarketContextModel.countDocuments();
    const withMarketData = await RouteMarketContextModel.countDocuments({
      marketSnapshot: { $ne: null }
    });
    const highRisk = await RouteMarketContextModel.countDocuments({
      'contextualRisk.contextualDumpRiskScore': { $gte: 70 }
    });
    const stressed = await RouteMarketContextModel.countDocuments({
      'marketSnapshot.isStressed': true
    });
    
    // Aggregate by tags
    const tagAgg = await RouteMarketContextModel.aggregate([
      { $unwind: '$contextualRisk.contextTags' },
      { $group: { _id: '$contextualRisk.contextTags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);
    
    return {
      ok: true,
      stats: {
        totalContexts: total,
        withMarketData,
        withoutMarketData: total - withMarketData,
        highRiskCount: highRisk,
        stressedMarketCount: stressed,
        coveragePercent: total > 0 ? Math.round((withMarketData / total) * 100) : 0,
        topTags: tagAgg.map(t => ({ tag: t._id, count: t.count }))
      }
    };
  });
  
  // ========================================
  // GET /features/:routeId
  // ========================================
  fastify.get<{
    Params: { routeId: string };
  }>('/features/:routeId', async (request, reply) => {
    const { routeId } = request.params;
    
    const features = await marketRouteFeatureProvider.getFeatures(routeId);
    
    return {
      ok: true,
      routeId,
      features
    };
  });
  
  // ========================================
  // POST /build
  // ========================================
  fastify.post<{
    Body: RouteData;
  }>('/build', async (request, reply) => {
    const routeData = request.body;
    
    if (!routeData.routeId || !routeData.token) {
      return reply.status(400).send({
        ok: false,
        error: 'routeId and token are required'
      });
    }
    
    // Set defaults
    routeData.routeType = routeData.routeType || 'EXIT';
    routeData.exitProbability = routeData.exitProbability ?? 0.5;
    routeData.dumpRiskScore = routeData.dumpRiskScore ?? 50;
    routeData.pathEntropy = routeData.pathEntropy ?? 0.5;
    routeData.hasCexTouchpoint = routeData.hasCexTouchpoint ?? false;
    routeData.hasSwapBeforeExit = routeData.hasSwapBeforeExit ?? false;
    routeData.firstSeenAt = routeData.firstSeenAt || Date.now();
    routeData.lastSeenAt = routeData.lastSeenAt || Date.now();
    
    const result = await routeContextBuilder.buildContext(routeData);
    
    if (!result.ok) {
      return reply.status(500).send({
        ok: false,
        error: result.error
      });
    }
    
    return {
      ok: true,
      isNew: result.isNew,
      context: result.context ? {
        routeId: result.context.routeId,
        token: result.context.token,
        contextualRisk: result.context.contextualRisk,
        sourceQuality: result.context.sourceQuality
      } : null
    };
  });
  
  // ========================================
  // POST /recompute/:routeId
  // ========================================
  fastify.post<{
    Params: { routeId: string };
  }>('/recompute/:routeId', async (request, reply) => {
    const { routeId } = request.params;
    
    const result = await routeContextBuilder.refreshContext(routeId);
    
    if (!result.ok) {
      return reply.status(404).send({
        ok: false,
        error: result.error
      });
    }
    
    return {
      ok: true,
      context: result.context ? {
        routeId: result.context.routeId,
        contextualRisk: result.context.contextualRisk,
        sourceQuality: result.context.sourceQuality
      } : null
    };
  });
  
  // ========================================
  // GET /recent
  // ========================================
  fastify.get<{
    Querystring: { token?: string; limit?: string };
  }>('/recent', async (request, reply) => {
    const { token, limit } = request.query;
    
    const contexts = await getRecentContexts(
      token,
      parseInt(limit || '50')
    );
    
    return {
      ok: true,
      count: contexts.length,
      contexts: contexts.map(c => ({
        routeId: c.routeId,
        token: c.token,
        contextualRisk: c.contextualRisk,
        resolvedAt: c.resolvedAt
      }))
    };
  });
}
