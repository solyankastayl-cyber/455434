/**
 * Advanced Routes - 3 endpoints for Advanced v2
 */

import type { FastifyInstance } from 'fastify';
import { advancedSystemOverviewService } from './services/system-overview.service.js';
import { advancedMLHealthService } from './services/ml-health.service.js';
import { advancedSignalsAttributionService } from './services/signals-attribution.service.js';

export async function advancedRoutes(app: FastifyInstance) {
  /**
   * GET /api/advanced/system-overview
   * Main Advanced screen - "Can I trust the system?"
   */
  app.get('/system-overview', async (req, reply) => {
    try {
      const data = await advancedSystemOverviewService.getSystemOverview();
      reply.send(data);
    } catch (err: any) {
      app.log.error('[Advanced] System overview error:', err);
      reply.status(500).send({ error: 'Failed to fetch system overview' });
    }
  });

  /**
   * GET /api/advanced/ml-health
   * ML Health - "Is ML ready and safe?"
   */
  app.get('/ml-health', async (req, reply) => {
    try {
      const data = await advancedMLHealthService.getMLHealth();
      reply.send(data);
    } catch (err: any) {
      app.log.error('[Advanced] ML health error:', err);
      reply.status(500).send({ error: 'Failed to fetch ML health' });
    }
  });

  /**
   * GET /api/advanced/signals-attribution
   * Signals & Attribution - "Why system thinks this way?"
   */
  app.get('/signals-attribution', async (req, reply) => {
    try {
      const data = await advancedSignalsAttributionService.getSignalsAttribution();
      reply.send(data);
    } catch (err: any) {
      app.log.error('[Advanced] Signals attribution error:', err);
      reply.status(500).send({ error: 'Failed to fetch signals attribution' });
    }
  });

  app.log.info('[Advanced] Routes registered: /api/advanced/*');
}
