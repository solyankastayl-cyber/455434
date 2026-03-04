/**
 * P0.2a Price & Provider Routes
 * 
 * API endpoints for:
 * - Price queries (read from snapshot)
 * - Provider status
 * - Token universe management
 * - Snapshot job control
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function priceRoutes(app: FastifyInstance): Promise<void> {
  
  // ============================================
  // PRICE ENDPOINTS
  // ============================================
  
  /**
   * GET /api/v2/price/:asset
   * Get latest price for asset (from snapshot)
   */
  app.get('/:asset', async (
    request: FastifyRequest<{ Params: { asset: string }; Querystring: { network?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { getLatestPrice } = await import('./price.service.js');
      const { trackTokenRequest } = await import('./token_universe.model.js');
      
      const { asset } = request.params;
      const network = request.query.network || 'ethereum';
      
      // Track request for auto-expansion metrics
      trackTokenRequest(asset, network).catch(() => {});
      
      const snapshot = await getLatestPrice(asset, network);
      
      if (!snapshot) {
        return reply.code(404).send({
          ok: false,
          error: 'PRICE_NOT_FOUND',
          message: `No price data for ${asset} on ${network}`,
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          asset: snapshot.asset,
          network: snapshot.network,
          priceUsd: snapshot.priceUsd,
          ts: snapshot.ts,
          source: snapshot.source,
          age: Math.floor(Date.now() / 1000) - snapshot.ts,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'PRICE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/batch
   * Get prices for multiple assets
   */
  app.post('/batch', async (
    request: FastifyRequest<{ Body: { assets: string[]; network?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { getPrices } = await import('./price.service.js');
      
      const { assets, network } = request.body;
      
      if (!assets || !Array.isArray(assets)) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_REQUEST',
          message: 'assets array required',
        });
      }
      
      const prices = await getPrices(assets, network || 'ethereum');
      
      return reply.send({
        ok: true,
        data: { prices },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'BATCH_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/:asset/refresh
   * Force refresh price from external provider
   */
  app.post('/:asset/refresh', async (
    request: FastifyRequest<{ Params: { asset: string }; Querystring: { network?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { refreshPrice } = await import('./price.service.js');
      
      const { asset } = request.params;
      const network = request.query.network || 'ethereum';
      
      const snapshot = await refreshPrice(asset, network);
      
      if (!snapshot) {
        return reply.code(503).send({
          ok: false,
          error: 'REFRESH_FAILED',
          message: 'Could not refresh price (provider unavailable)',
        });
      }
      
      return reply.send({
        ok: true,
        data: {
          asset: snapshot.asset,
          network: snapshot.network,
          priceUsd: snapshot.priceUsd,
          ts: snapshot.ts,
          source: snapshot.source,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'REFRESH_ERROR',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // PROVIDER ENDPOINTS
  // ============================================
  
  /**
   * GET /api/v2/price/providers/status
   * Get status of all providers
   */
  app.get('/providers/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { getProviderPool } = await import('../providers/provider_pool.service.js');
      
      const pool = getProviderPool();
      const status = pool.getStatus();
      
      return reply.send({
        ok: true,
        data: {
          providers: status,
          summary: {
            total: status.length,
            healthy: status.filter((p) => p.healthy).length,
            inCooldown: status.filter((p) => !p.healthy).length,
          },
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/providers/reset
   * Reset all provider states (admin)
   */
  app.post('/providers/reset', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { getProviderPool } = await import('../providers/provider_pool.service.js');
      
      const pool = getProviderPool();
      pool.reset();
      
      return reply.send({
        ok: true,
        message: 'All providers reset',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RESET_ERROR',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // TOKEN UNIVERSE ENDPOINTS
  // ============================================
  
  /**
   * GET /api/v2/price/universe
   * Get token universe info
   */
  app.get('/universe', async (
    request: FastifyRequest<{ Querystring: { tier?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { getUniverseStats, getEnabledTokens, getTokensByTier } = 
        await import('./token_universe.model.js');
      
      const { tier } = request.query;
      
      const stats = await getUniverseStats();
      
      let tokens;
      if (tier) {
        tokens = await getTokensByTier(tier as any);
      } else {
        tokens = await getEnabledTokens(50); // Limit for API response
      }
      
      return reply.send({
        ok: true,
        data: {
          stats,
          tokens: tokens.map((t) => ({
            symbol: t.symbol,
            name: t.name,
            network: t.network,
            tier: t.tier,
            enabled: t.enabled,
            requestCount: t.requestCount,
          })),
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'UNIVERSE_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/universe/token
   * Add token to universe (admin)
   */
  app.post('/universe/token', async (
    request: FastifyRequest<{
      Body: {
        symbol: string;
        name: string;
        network: string;
        tier?: string;
        coingeckoId?: string;
      };
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { addToken } = await import('./token_universe.model.js');
      
      const { symbol, name, network, tier, coingeckoId } = request.body;
      
      if (!symbol || !name || !network) {
        return reply.code(400).send({
          ok: false,
          error: 'INVALID_REQUEST',
          message: 'symbol, name, network required',
        });
      }
      
      const token = await addToken(symbol, name, network, {
        tier: tier as any,
        coingeckoId,
      });
      
      return reply.send({
        ok: true,
        data: {
          symbol: token.symbol,
          name: token.name,
          network: token.network,
          tier: token.tier,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'ADD_TOKEN_ERROR',
        message: error.message,
      });
    }
  });
  
  // ============================================
  // SNAPSHOT JOB ENDPOINTS
  // ============================================
  
  /**
   * GET /api/v2/price/snapshot/status
   * Get snapshot job status
   */
  app.get('/snapshot/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { getJobStatus, getSnapshotStats, isSchedulerRunning } = 
        await import('./price_snapshot.job.js');
      const { getCacheStats } = await import('./price.service.js');
      
      const jobStatus = getJobStatus();
      const dbStats = await getSnapshotStats();
      const cacheStats = getCacheStats();
      
      return reply.send({
        ok: true,
        data: {
          job: {
            isRunning: jobStatus.isRunning,
            schedulerActive: isSchedulerRunning(),
            lastRunAt: jobStatus.lastRunAt,
            lastStats: jobStatus.lastStats,
          },
          providers: jobStatus.providerStatus,
          database: dbStats,
          cache: cacheStats,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STATUS_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/snapshot/run
   * Manually trigger snapshot job
   */
  app.post('/snapshot/run', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { runPriceSnapshotJob } = await import('./price_snapshot.job.js');
      
      const stats = await runPriceSnapshotJob();
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'RUN_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/snapshot/scheduler/start
   * Start snapshot scheduler
   */
  app.post('/snapshot/scheduler/start', async (
    request: FastifyRequest<{ Body: { intervalMs?: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { startScheduler } = await import('./price_snapshot.job.js');
      
      const intervalMs = request.body?.intervalMs || 60000;
      startScheduler(intervalMs);
      
      return reply.send({
        ok: true,
        message: `Scheduler started (interval: ${intervalMs}ms)`,
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'START_ERROR',
        message: error.message,
      });
    }
  });
  
  /**
   * POST /api/v2/price/snapshot/scheduler/stop
   * Stop snapshot scheduler
   */
  app.post('/snapshot/scheduler/stop', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    try {
      const { stopScheduler } = await import('./price_snapshot.job.js');
      
      stopScheduler();
      
      return reply.send({
        ok: true,
        message: 'Scheduler stopped',
      });
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: 'STOP_ERROR',
        message: error.message,
      });
    }
  });
  
  app.log.info('[P0.2a] Price & Provider routes registered');
}

export default priceRoutes;
