/**
 * Graph Metrics Routes
 * 
 * API endpoints for graph analytics metrics
 */

import type { FastifyPluginAsync } from 'fastify';
import { calculateGraphMetrics } from './metrics.service.js';

type WindowParam = '24h' | '7d' | '30d';

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  
  /**
   * GET /metrics
   * Get analytics metrics for the graph
   */
  app.get('/metrics', async (req, reply) => {
    const query = req.query as { window?: string };
    const window = (query.window || '7d') as WindowParam;
    
    try {
      const metrics = await calculateGraphMetrics(window);
      
      return reply.send({
        ok: true,
        data: metrics,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'METRICS_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
  
  /**
   * GET /metrics/summary
   * Get quick summary of key metrics
   */
  app.get('/metrics/summary', async (req, reply) => {
    const query = req.query as { window?: string };
    const window = (query.window || '7d') as WindowParam;
    
    try {
      const metrics = await calculateGraphMetrics(window);
      
      return reply.send({
        ok: true,
        data: {
          nodes: metrics.overview.totalNodes,
          edges: metrics.overview.totalEdges,
          relations: metrics.overview.totalRelations,
          exposureIn: metrics.exposure.totalInflowUsd,
          exposureOut: metrics.exposure.totalOutflowUsd,
          netFlow: metrics.exposure.netFlowUsd,
          lastActivity: metrics.activity.lastSeenTimestamp,
          riskFlags: metrics.riskFlags.total,
        },
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'SUMMARY_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
};
