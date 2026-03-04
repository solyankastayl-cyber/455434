/**
 * ML Ready Dashboard v2 API Routes
 * 
 * Provides comprehensive ML readiness analysis endpoints
 */
import type { FastifyInstance } from 'fastify';
import { getMLReadySummaryV2 } from './ml_ready_v2.service.js';

export async function mlReadyV2Routes(app: FastifyInstance): Promise<void> {
  
  /**
   * GET /api/ml-ready/v2/summary
   * Get complete ML readiness analysis
   */
  app.get('/ml-ready/v2/summary', async () => {
    try {
      const summary = await getMLReadySummaryV2();
      
      return {
        ok: true,
        data: summary,
      };
    } catch (err: any) {
      app.log.error('[ML Ready v2] Failed to get summary:', err);
      return {
        ok: false,
        error: 'Failed to get ML ready summary',
        details: err.message,
      };
    }
  });
  
  /**
   * GET /api/ml-ready/v2/verdict
   * Get just the verdict (lightweight)
   */
  app.get('/ml-ready/v2/verdict', async () => {
    try {
      const summary = await getMLReadySummaryV2();
      
      return {
        ok: true,
        data: {
          verdict: summary.verdict,
          actions: summary.actions,
          lastUpdated: summary.lastUpdated,
        },
      };
    } catch (err: any) {
      return {
        ok: false,
        error: 'Failed to get ML verdict',
        details: err.message,
      };
    }
  });
  
  app.log.info('[ML Ready v2] Routes registered');
}
