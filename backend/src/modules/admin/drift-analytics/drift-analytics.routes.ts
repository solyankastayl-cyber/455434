/**
 * P6 DRIFT ANALYTICS ROUTES
 * 
 * Endpoints:
 * - GET /api/admin/:scope/drift/by-horizon    — P6-A
 * - GET /api/admin/:scope/drift/rolling       — P6-B
 * - GET /api/admin/:scope/drift/by-regime     — P6-C
 * 
 * Note: P6-D (compare) and P6-E (weights) are in composite.lifecycle.routes.ts
 */

import { FastifyInstance } from 'fastify';
import {
  getByHorizon,
  getRolling,
  getByRegime,
  AdminScope
} from './drift-analytics.service.js';

const SCOPE_ALIASES: Record<string, AdminScope> = {
  'btc': 'BTC',
  'spx': 'SPX',
  'dxy': 'DXY',
  'cross': 'CROSS_ASSET',
  'cross_asset': 'CROSS_ASSET',
  'crossasset': 'CROSS_ASSET',
  'BTC': 'BTC',
  'SPX': 'SPX',
  'DXY': 'DXY',
  'CROSS_ASSET': 'CROSS_ASSET',
};

export async function registerDriftAnalyticsRoutes(fastify: FastifyInstance) {
  
  /**
   * P6-A: GET /api/admin/:scope/drift/by-horizon
   * 
   * Per-horizon breakdown with:
   * - sampleCount, hitRate, avgAbsError, avgError
   * - p50/p90/p95/max percentiles
   * - trend (rolling)
   */
  fastify.get('/api/admin/:scope/drift/by-horizon', async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const { includeSeed } = req.query as { includeSeed?: string };
    
    const normalizedScope = SCOPE_ALIASES[scope];
    if (!normalizedScope) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid scope',
        validScopes: ['btc', 'spx', 'dxy', 'cross']
      });
    }
    
    try {
      const result = await getByHorizon(normalizedScope, includeSeed === 'true');
      return result;
    } catch (err) {
      console.error('[P6-A] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: (err as Error).message
      });
    }
  });
  
  /**
   * P6-B: GET /api/admin/:scope/drift/rolling
   * 
   * Rolling window trend analysis.
   * Query params:
   *   horizon - e.g., '30d' (default)
   *   window - window size (default 50)
   *   includeSeed - 'true' or 'false'
   */
  fastify.get('/api/admin/:scope/drift/rolling', async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const { horizon, window, includeSeed } = req.query as {
      horizon?: string;
      window?: string;
      includeSeed?: string;
    };
    
    const normalizedScope = SCOPE_ALIASES[scope];
    if (!normalizedScope) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid scope',
        validScopes: ['btc', 'spx', 'dxy', 'cross']
      });
    }
    
    try {
      const result = await getRolling(
        normalizedScope,
        horizon || '30d',
        parseInt(window || '50'),
        includeSeed === 'true'
      );
      return result;
    } catch (err) {
      console.error('[P6-B] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: (err as Error).message
      });
    }
  });
  
  /**
   * P6-C: GET /api/admin/:scope/drift/by-regime
   * 
   * Regime segmentation:
   * - BULL_LOW_VOL, BULL_HIGH_VOL
   * - BEAR_LOW_VOL, BEAR_HIGH_VOL
   */
  fastify.get('/api/admin/:scope/drift/by-regime', async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const { horizon, includeSeed } = req.query as {
      horizon?: string;
      includeSeed?: string;
    };
    
    const normalizedScope = SCOPE_ALIASES[scope];
    if (!normalizedScope) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid scope',
        validScopes: ['btc', 'spx', 'dxy', 'cross']
      });
    }
    
    try {
      const result = await getByRegime(
        normalizedScope,
        horizon || '30d',
        includeSeed === 'true'
      );
      return result;
    } catch (err) {
      console.error('[P6-C] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: (err as Error).message
      });
    }
  });
  
  console.log('[P6] Drift Analytics routes registered:');
  console.log('  GET /api/admin/:scope/drift/by-horizon');
  console.log('  GET /api/admin/:scope/drift/rolling');
  console.log('  GET /api/admin/:scope/drift/by-regime');
}

export default registerDriftAnalyticsRoutes;
