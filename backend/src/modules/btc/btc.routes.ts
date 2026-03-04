/**
 * BTC TERMINAL — API Routes
 * 
 * BLOCK A1 — BTC API Namespace /api/btc/v2.1/*
 * 
 * Proxies all BTC-specific endpoints from Fractal core.
 * This creates a clean separation where BTC is a standalone product.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import BTC_CONFIG from './btc.config.js';

export async function registerBtcRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = BTC_CONFIG.apiPrefix;
  
  // ═══════════════════════════════════════════════════════════════
  // TERMINAL ENDPOINTS (User-facing)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/btc/v2.1/terminal
   * Main BTC terminal data
   */
  fastify.get(`${prefix}/terminal`, async (req: FastifyRequest, reply: FastifyReply) => {
    // Proxy to fractal terminal with symbol=BTC forced
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/terminal?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  /**
   * GET /api/btc/v2.1/focus-pack
   * BTC Focus Pack (horizons + signal)
   */
  fastify.get(`${prefix}/focus-pack`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/focus-pack?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  /**
   * GET /api/btc/v2.1/replay-pack
   * BTC Replay Pack (match details)
   */
  fastify.get(`${prefix}/replay-pack`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/replay-pack?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  /**
   * GET /api/btc/v2.1/chart
   * BTC Price chart data
   */
  fastify.get(`${prefix}/chart`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/chart?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  /**
   * GET /api/btc/v2.1/multi-signal
   * BTC Multi-horizon signal
   */
  fastify.get(`${prefix}/multi-signal`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/multi-signal?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  /**
   * GET /api/btc/v2.1/regime
   * BTC Volatility regime
   */
  fastify.get(`${prefix}/regime`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    const fractalUrl = `/api/fractal/v2.1/regime?${queryString.toString()}`;
    return reply.redirect(302, fractalUrl);
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/btc/v2.1/admin/overview
   * BTC Admin overview
   */
  fastify.get(`${prefix}/admin/overview`, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(302, '/api/fractal/v2.1/admin/overview');
  });
  
  /**
   * GET /api/btc/v2.1/admin/model-health
   * BTC Model health
   */
  fastify.get(`${prefix}/admin/model-health`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    return reply.redirect(302, `/api/fractal/v2.1/admin/model-health?${queryString.toString()}`);
  });
  
  /**
   * GET /api/btc/v2.1/admin/intel/timeline
   * BTC Intel Timeline
   */
  fastify.get(`${prefix}/admin/intel/timeline`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    return reply.redirect(302, `/api/fractal/v2.1/admin/intel/timeline?${queryString.toString()}`);
  });
  
  /**
   * GET /api/btc/v2.1/admin/intel/alerts
   * BTC Intel Alerts
   */
  fastify.get(`${prefix}/admin/intel/alerts`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    return reply.redirect(302, `/api/fractal/v2.1/admin/intel/alerts?${queryString.toString()}`);
  });
  
  /**
   * GET /api/btc/v2.1/admin/drift/intelligence
   * BTC Drift Intelligence
   */
  fastify.get(`${prefix}/admin/drift/intelligence`, async (req: FastifyRequest, reply: FastifyReply) => {
    const queryString = new URLSearchParams(req.query as any);
    queryString.set('symbol', 'BTC');
    
    return reply.redirect(302, `/api/fractal/v2.1/admin/drift/intelligence?${queryString.toString()}`);
  });
  
  /**
   * POST /api/btc/v2.1/admin/jobs/daily-run
   * BTC Daily Run
   */
  fastify.post(`${prefix}/admin/jobs/daily-run`, async (req: FastifyRequest, reply: FastifyReply) => {
    return reply.redirect(307, '/api/fractal/v2.1/admin/jobs/daily-run-tg-open');
  });
  
  // ═══════════════════════════════════════════════════════════════
  // INFO ENDPOINT
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/btc/v2.1/info
   * BTC Product info
   */
  fastify.get(`${prefix}/info`, async () => {
    return {
      product: 'BTC Terminal',
      version: BTC_CONFIG.contractVersion,
      symbol: BTC_CONFIG.symbol,
      frozen: BTC_CONFIG.frozen,
      horizons: BTC_CONFIG.horizons,
      governance: BTC_CONFIG.governance,
      status: 'FINAL',
      description: 'Pure BTC Fractal Terminal - No external dependencies',
    };
  });
  
  fastify.log.info(`[BTC] Terminal routes registered at ${prefix}/*`);
  fastify.log.info(`[BTC] Contract: ${BTC_CONFIG.contractVersion} (FROZEN)`);
}

export default registerBtcRoutes;
