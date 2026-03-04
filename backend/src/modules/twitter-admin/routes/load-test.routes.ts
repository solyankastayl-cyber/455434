/**
 * Stage D: Load Testing Routes
 * 
 * Admin endpoints for load testing and performance monitoring:
 * - Performance snapshots
 * - Latency distribution
 * - Abort analysis
 * - User/Session performance stats
 */

import type { FastifyInstance } from 'fastify';
import { loadTestService } from '../services/load-test.service.js';

export async function registerLoadTestRoutes(app: FastifyInstance) {
  console.log('[BOOT] Registering load test routes');
  
  /**
   * GET /api/v4/admin/twitter/performance/snapshot
   * Get performance snapshot for a time window
   */
  app.get('/api/v4/admin/twitter/performance/snapshot', async (req, reply) => {
    try {
      const { window = '24h' } = req.query as { window?: '1h' | '24h' | '7d' };
      
      const snapshot = await loadTestService.getPerformanceSnapshot(window);
      
      return reply.send({
        ok: true,
        data: snapshot,
      });
    } catch (err: any) {
      app.log.error(err, 'Performance snapshot error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/performance/latency
   * Get latency distribution
   */
  app.get('/api/v4/admin/twitter/performance/latency', async (req, reply) => {
    try {
      const { window = '24h' } = req.query as { window?: '1h' | '24h' };
      
      const distribution = await loadTestService.getLatencyDistribution(window);
      
      return reply.send({
        ok: true,
        data: distribution,
      });
    } catch (err: any) {
      app.log.error(err, 'Latency distribution error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/performance/aborts
   * Get abort analysis
   */
  app.get('/api/v4/admin/twitter/performance/aborts', async (req, reply) => {
    try {
      const { window = '24h' } = req.query as { window?: '24h' | '7d' };
      
      const analysis = await loadTestService.getAbortAnalysis(window);
      
      return reply.send({
        ok: true,
        data: analysis,
      });
    } catch (err: any) {
      app.log.error(err, 'Abort analysis error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/performance/users
   * Get user-level performance stats
   */
  app.get('/api/v4/admin/twitter/performance/users', async (req, reply) => {
    try {
      const { userId } = req.query as { userId?: string };
      
      const stats = await loadTestService.getUserPerformanceStats(userId);
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err: any) {
      app.log.error(err, 'User performance stats error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/v4/admin/twitter/performance/sessions
   * Get session performance stats
   */
  app.get('/api/v4/admin/twitter/performance/sessions', async (req, reply) => {
    try {
      const stats = await loadTestService.getSessionPerformanceStats();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err: any) {
      app.log.error(err, 'Session performance stats error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}
