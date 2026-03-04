/**
 * Admin Dashboard Routes
 * 
 * Unified endpoints for admin UI.
 * 
 * Routes:
 *   GET /api/admin/:scope/dashboard — Get dashboard for specific scope
 *   GET /api/admin/dashboards — Get dashboards for all scopes
 */

import { FastifyInstance } from 'fastify';
import { getDashboard, getAllDashboards } from './dashboard.service.js';
import { AdminScope } from './dashboard.contract.js';

const VALID_SCOPES: AdminScope[] = ['BTC', 'SPX', 'DXY', 'CROSS_ASSET'];

// Alias mapping for cleaner URLs
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

export async function registerDashboardRoutes(fastify: FastifyInstance) {
  
  /**
   * GET /api/admin/:scope/dashboard
   * 
   * Get unified dashboard for a specific scope.
   * This is the ONLY endpoint UI should use for admin data.
   * 
   * Query params:
   *   includeSeed - if 'true', includes seed_backtest data in metrics
   */
  fastify.get('/api/admin/:scope/dashboard', async (req, reply) => {
    const { scope } = req.params as { scope: string };
    const { includeSeed } = req.query as { includeSeed?: string };
    
    const normalizedScope = SCOPE_ALIASES[scope];
    const includeSeedBool = includeSeed === 'true';
    
    if (!normalizedScope) {
      return reply.status(400).send({
        ok: false,
        error: 'Invalid scope',
        message: `Scope must be one of: btc, spx, dxy, cross`,
        validScopes: ['btc', 'spx', 'dxy', 'cross'],
      });
    }
    
    try {
      const data = await getDashboard(normalizedScope, includeSeedBool);
      return { ok: true, data, includeSeed: includeSeedBool };
    } catch (err) {
      console.error(`[Dashboard] Error fetching ${normalizedScope}:`, err);
      return reply.status(500).send({
        ok: false,
        error: 'Dashboard fetch failed',
        message: (err as Error).message,
      });
    }
  });
  
  /**
   * GET /api/admin/dashboards
   * 
   * Get dashboards for all scopes in one call.
   * Useful for Overview page that shows all scopes.
   */
  fastify.get('/api/admin/dashboards', async (req, reply) => {
    try {
      const data = await getAllDashboards();
      return { ok: true, data };
    } catch (err) {
      console.error('[Dashboard] Error fetching all dashboards:', err);
      return reply.status(500).send({
        ok: false,
        error: 'Dashboard fetch failed',
        message: (err as Error).message,
      });
    }
  });
  
  console.log('[Dashboard] Routes registered:');
  console.log('  GET /api/admin/:scope/dashboard');
  console.log('  GET /api/admin/dashboards');
}

export default registerDashboardRoutes;
