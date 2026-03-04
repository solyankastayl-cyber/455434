/**
 * TA Routes - API endpoints for Technical Analysis module
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { TaService } from './ta.service.js';
import { TaAnalyzeRequestSchema } from './ta.contracts.js';
import { 
  getConfig, 
  updateConfig, 
  isFrozen, 
  initConfig,
  TAConfig
} from './infra/config.js';
import { getMetrics } from './infra/metrics.js';
import { getCircuitBreaker, getAllBreakers } from './infra/breaker.js';
import { getCandleCache } from './infra/cache.js';
import { getRateLimiter } from './infra/ratelimit.js';
import { logger, generateRequestId } from './infra/logger.js';
import { resetRNG, getRNG } from './infra/rng.js';
import { freezeGuard, isWriteOperation } from './infra/freeze.js';

export async function taRoutes(app: FastifyInstance): Promise<void> {
  const taService = new TaService();
  
  // Initialize config on startup
  initConfig();

  // Request ID middleware
  app.addHook('preHandler', async (request, reply) => {
    const requestId = (request.headers['x-request-id'] as string) || generateRequestId();
    logger.setRequestId(requestId);
    reply.header('x-request-id', requestId);
    getMetrics().recordRequest();
  });

  // Freeze guard for write operations
  app.addHook('preHandler', async (request, reply) => {
    if (isFrozen() && isWriteOperation(request.method)) {
      const path = request.url.split('?')[0];
      
      // Allow analyze and decision (read-only compute)
      if (path.includes('/analyze') || path.includes('/decision')) {
        return;
      }
      
      reply.status(503).send({
        ok: false,
        error: 'SERVICE_FROZEN',
        message: 'TA module is in freeze mode. Write operations are disabled.',
        freezeEnabled: true,
      });
    }
  });

  app.addHook('onResponse', async () => {
    logger.clearRequestId();
  });

  // Health check
  app.get('/health', async () => {
    return taService.health();
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S4: Metrics endpoint
  // ═══════════════════════════════════════════════════════════════
  
  app.get('/metrics', async () => {
    const metrics = getMetrics().getMetrics();
    return {
      ok: true,
      ...metrics,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S2: Provider status endpoint
  // ═══════════════════════════════════════════════════════════════
  
  app.get('/provider/status', async () => {
    const config = getConfig();
    const breaker = getCircuitBreaker('provider');
    const breakerStats = breaker.getStats();
    const cache = getCandleCache();
    const cacheStats = cache.getStats();
    const rateLimiter = getRateLimiter();
    const rlStats = rateLimiter.getStats();
    
    return {
      ok: true,
      provider: config.provider,
      breaker: {
        state: breakerStats.state,
        consecutiveFailures: breakerStats.consecutiveFailures,
        timeUntilReset: breakerStats.timeUntilReset,
        totalCalls: breakerStats.totalCalls,
        totalFailures: breakerStats.totalFailures,
        totalRejected: breakerStats.totalRejected,
      },
      cache: {
        size: cacheStats.size,
        maxKeys: cacheStats.maxKeys,
        hitRate: cacheStats.hitRate,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
      },
      rateLimit: {
        rps: rlStats.rps,
        allowed: rlStats.allowed,
        rejected: rlStats.rejected,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S1: Admin endpoints (freeze, config)
  // ═══════════════════════════════════════════════════════════════
  
  app.get('/admin/config', async () => {
    return {
      ok: true,
      config: getConfig(),
      frozen: isFrozen(),
    };
  });
  
  app.post('/admin/freeze', async (request: FastifyRequest<{
    Body: { enabled: boolean }
  }>) => {
    const { enabled } = request.body || { enabled: true };
    
    try {
      updateConfig({ freezeEnabled: enabled });
      logger.info({ phase: 'admin', action: 'freeze', enabled }, 'Freeze state changed');
      return {
        ok: true,
        freezeEnabled: enabled,
      };
    } catch (error) {
      return {
        ok: false,
        error: (error as Error).message,
      };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S3: Determinism - RNG reset
  // ═══════════════════════════════════════════════════════════════

  app.post('/admin/rng/reset', async () => {
    resetRNG();
    const rng = getRNG();
    return {
      ok: true,
      seed: rng.getState(),
      message: 'RNG reset to configured seed',
    };
  });

  app.get('/admin/rng/state', async () => {
    const rng = getRNG();
    const config = getConfig();
    return {
      ok: true,
      currentState: rng.getState(),
      configuredSeed: config.seed,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S2: Cache management
  // ═══════════════════════════════════════════════════════════════

  app.post('/admin/cache/clear', async () => {
    const cache = getCandleCache();
    const beforeSize = cache.getStats().size;
    cache.clear();
    return {
      ok: true,
      cleared: beforeSize,
      message: `Cleared ${beforeSize} cache entries`,
    };
  });

  app.post('/admin/cache/prune', async () => {
    const cache = getCandleCache();
    const pruned = cache.prune();
    return {
      ok: true,
      pruned,
      message: `Pruned ${pruned} expired entries`,
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // Phase S2: Breaker management
  // ═══════════════════════════════════════════════════════════════

  app.get('/admin/breakers', async () => {
    const breakers = getAllBreakers();
    const result: Record<string, any> = {};
    
    for (const [name, breaker] of breakers) {
      result[name] = breaker.getStats();
    }
    
    return {
      ok: true,
      breakers: result,
    };
  });

  app.post('/admin/breaker/reset', async (request: FastifyRequest<{
    Body: { service?: string }
  }>) => {
    const { service = 'provider' } = request.body || {};
    const breaker = getCircuitBreaker(service);
    breaker.reset();
    
    return {
      ok: true,
      service,
      state: breaker.getState(),
      message: `Circuit breaker "${service}" reset to CLOSED`,
    };
  });

  // Main analyze endpoint
  app.get('/analyze', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string; lookback?: string }
  }>) => {
    const { asset = 'BTC', timeframe = '1D', lookback = '200' } = request.query;
    
    const parsed = TaAnalyzeRequestSchema.parse({
      asset,
      timeframe,
      lookback: parseInt(lookback, 10)
    });

    return taService.analyze(parsed);
  });

  // POST version for more complex requests
  app.post('/analyze', async (request: FastifyRequest<{
    Body: { asset: string; timeframe?: string; lookback?: number }
  }>) => {
    const parsed = TaAnalyzeRequestSchema.parse(request.body);
    return taService.analyze(parsed);
  });

  // Get market structure
  app.get('/structure', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string }
  }>) => {
    const { asset = 'BTC', timeframe = '1D' } = request.query;
    const result = await taService.analyze({ asset, timeframe, lookback: 200 });
    return {
      ok: result.ok,
      asset,
      timeframe,
      structure: result.structure,
      timestamp: result.timestamp
    };
  });

  // Get support/resistance levels
  app.get('/levels', async (request: FastifyRequest<{
    Querystring: { asset?: string; timeframe?: string }
  }>) => {
    const { asset = 'BTC', timeframe = '1D' } = request.query;
    const result = await taService.analyze({ asset, timeframe, lookback: 200 });
    return {
      ok: result.ok,
      asset,
      timeframe,
      levels: result.levels,
      timestamp: result.timestamp
    };
  });
}
