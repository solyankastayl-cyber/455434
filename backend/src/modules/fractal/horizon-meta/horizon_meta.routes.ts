/**
 * HORIZON META ROUTES — API Endpoints
 * 
 * Endpoints:
 * - GET /api/fractal/horizon-meta/config - Get current config
 * - POST /api/fractal/horizon-meta/config - Update config (admin)
 * - GET /api/fractal/horizon-meta/tracking/:asset/:horizon - Get projection tracking
 * - POST /api/fractal/horizon-meta/test - Run validation tests
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getHorizonMetaService,
  loadHorizonMetaConfig,
  getProjectionTrackingPack,
  type HorizonKey,
} from './index.js';
import { runHorizonMetaTests } from './horizon_meta.tests.js';

// ═══════════════════════════════════════════════════════════════
// ROUTES REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function horizonMetaRoutes(fastify: FastifyInstance): Promise<void> {
  
  // GET config
  fastify.get('/api/fractal/horizon-meta/config', async (_req, reply) => {
    const config = loadHorizonMetaConfig();
    const service = getHorizonMetaService();
    
    return reply.send({
      ok: true,
      config,
      serviceConfig: service.getConfig(),
    });
  });
  
  // POST update config
  fastify.post('/api/fractal/horizon-meta/config', async (req, reply) => {
    const body = req.body as {
      enabled?: boolean;
      mode?: 'shadow' | 'on';
    };
    
    const service = getHorizonMetaService();
    
    if (body.enabled !== undefined || body.mode !== undefined) {
      service.updateConfig({
        enabled: body.enabled,
        mode: body.mode,
      });
    }
    
    return reply.send({
      ok: true,
      message: 'Config updated',
      newConfig: service.getConfig(),
    });
  });
  
  // GET projection tracking
  fastify.get<{
    Params: { asset: string; horizon: string };
    Querystring: { lookback?: string };
  }>('/api/fractal/horizon-meta/tracking/:asset/:horizon', async (req, reply) => {
    const { asset, horizon } = req.params;
    const lookback = req.query.lookback ? parseInt(req.query.lookback) : undefined;
    
    const horizonNum = parseInt(horizon) as HorizonKey;
    if (![30, 90, 180, 365].includes(horizonNum)) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid horizon. Use 30, 90, 180, or 365',
      });
    }
    
    try {
      const pack = await getProjectionTrackingPack({
        asset: asset.toUpperCase(),
        horizon: horizonNum,
        lookback,
        realizedPrices: [], // Will be filled by caller
      });
      
      return reply.send({
        ok: true,
        tracking: pack,
      });
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  // POST run tests
  fastify.post('/api/fractal/horizon-meta/test', async (_req, reply) => {
    try {
      const results = runHorizonMetaTests();
      return reply.send({
        ok: results.failed === 0,
        ...results,
      });
    } catch (err: any) {
      return reply.status(500).send({
        ok: false,
        error: err.message,
      });
    }
  });
  
  console.log('[HorizonMeta] Routes registered at /api/fractal/horizon-meta/*');
}
