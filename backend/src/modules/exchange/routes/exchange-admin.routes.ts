/**
 * S10.1 — Exchange Admin Routes
 * 
 * Admin control panel for Exchange module:
 * - Enable/disable module
 * - Configure polling
 * - View health/status
 */

import { FastifyInstance } from 'fastify';
import * as exchangeService from '../exchange-data.service.js';

export async function exchangeAdminRoutes(fastify: FastifyInstance): Promise<void> {
  // Get config
  fastify.get('/api/admin/exchange/config', async () => {
    const config = await exchangeService.getConfig();
    return { ok: true, data: config };
  });

  // Update config
  fastify.patch<{ Body: {
    enabled?: boolean;
    pollingIntervalMs?: number;
    symbols?: string[];
  } }>('/api/admin/exchange/config', async (request) => {
    const updates = request.body;
    const config = await exchangeService.updateConfig(updates);
    return { ok: true, data: config };
  });

  // Start polling
  fastify.post('/api/admin/exchange/start', async () => {
    await exchangeService.startPolling();
    return {
      ok: true,
      message: 'Exchange polling started',
      running: exchangeService.isPollingRunning(),
    };
  });

  // Stop polling
  fastify.post('/api/admin/exchange/stop', async () => {
    exchangeService.stopPolling();
    return {
      ok: true,
      message: 'Exchange polling stopped',
      running: exchangeService.isPollingRunning(),
    };
  });

  // Get detailed health
  fastify.get('/api/admin/exchange/health', async () => {
    return {
      ok: true,
      data: exchangeService.getHealth(),
    };
  });

  // Get provider status
  fastify.get('/api/admin/exchange/provider', async () => {
    return {
      ok: true,
      data: exchangeService.getProviderStatus(),
    };
  });

  console.log('[S10] Exchange Admin routes registered: /api/admin/exchange/*');
}

export default exchangeAdminRoutes;
