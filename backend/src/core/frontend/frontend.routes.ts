/**
 * Frontend BFF Routes
 * Backend For Frontend - aggregation layer
 */

import type { FastifyInstance } from 'fastify';
import { dashboardService } from './services/dashboard.service.js';
import { tokenPageService } from './services/token_page.service.js';

export async function frontendRoutes(app: FastifyInstance) {
  /**
   * GET /api/frontend/dashboard
   * Dashboard with top tokens
   */
  app.get('/dashboard', async (req, reply) => {
    const { page = '1', limit = '20' } = req.query as any;

    try {
      const data = await dashboardService.getDashboard(
        parseInt(page, 10),
        parseInt(limit, 10)
      );

      reply.send(data);
    } catch (err: any) {
      app.log.error('[Frontend] Dashboard error:', err);
      reply.status(500).send({ error: 'Failed to fetch dashboard' });
    }
  });

  /**
   * GET /api/frontend/token/:symbol
   * Full token details
   */
  app.get('/token/:symbol', async (req, reply) => {
    const { symbol } = req.params as any;

    try {
      const data = await tokenPageService.getToken(symbol);
      reply.send(data);
    } catch (err: any) {
      if (err.message.includes('not found')) {
        reply.status(404).send({ error: err.message });
      } else {
        app.log.error('[Frontend] Token page error:', err);
        reply.status(500).send({ error: 'Failed to fetch token' });
      }
    }
  });

  app.log.info('[Frontend] BFF routes registered: /api/frontend/*');
}
