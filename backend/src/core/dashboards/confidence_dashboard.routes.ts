/**
 * P2.A — Confidence Dashboard Routes
 * 
 * API endpoints for confidence quality monitoring.
 */

import type { FastifyInstance } from 'fastify';
import { buildConfidenceDashboard } from './confidence_dashboard.service.js';

export async function confidenceDashboardRoutes(app: FastifyInstance) {
  /**
   * GET /api/admin/metrics/confidence-dashboard
   * 
   * Returns confidence quality metrics for monitoring.
   * 
   * Query params:
   * - days: number (1-365, default 30)
   * - limit: number (50-2000, default 300)
   */
  app.get('/api/admin/metrics/confidence-dashboard', async (request, reply) => {
    const query = request.query as { days?: string; limit?: string };
    
    const days = Math.max(1, Math.min(365, Number(query.days ?? 30)));
    const limit = Math.max(50, Math.min(2000, Number(query.limit ?? 300)));

    try {
      const dashboard = await buildConfidenceDashboard({ days, limit });
      return reply.send({ ok: true, data: dashboard });
    } catch (error) {
      console.error('[Confidence Dashboard] Error:', error);
      return reply.status(500).send({ 
        ok: false, 
        error: 'DASHBOARD_ERROR',
        message: 'Failed to build confidence dashboard' 
      });
    }
  });

  /**
   * GET /api/admin/metrics/confidence-summary
   * 
   * Quick summary stats for widgets.
   */
  app.get('/api/admin/metrics/confidence-summary', async (request, reply) => {
    const query = request.query as { days?: string };
    const days = Math.max(1, Math.min(365, Number(query.days ?? 7)));

    try {
      const dashboard = await buildConfidenceDashboard({ days, limit: 1 });
      return reply.send({ 
        ok: true, 
        data: {
          ...dashboard.summary,
          rangeDays: days,
        }
      });
    } catch (error) {
      console.error('[Confidence Summary] Error:', error);
      return reply.status(500).send({ 
        ok: false, 
        error: 'SUMMARY_ERROR',
        message: 'Failed to get confidence summary' 
      });
    }
  });

  console.log('[Dashboard] Routes registered: /api/admin/metrics/confidence-*');
}
