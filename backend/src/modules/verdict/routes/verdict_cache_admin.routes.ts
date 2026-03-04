/**
 * VERDICT CACHE ADMIN ROUTES
 * ==========================
 * 
 * P3: Smart Caching Layer - Blocks 9, 14, 15, 16
 * Admin endpoints for cache monitoring and management.
 * 
 * GET /api/admin/verdict-cache/stats - Cache statistics
 * GET /api/admin/verdict-cache/metrics - Full metrics (Block 16)
 * GET /api/admin/verdict-cache/health - Quick health summary
 * POST /api/admin/verdict-cache/invalidate - Invalidate cache entries
 * POST /api/admin/verdict-cache/warmup - Trigger manual warmup
 * GET /api/admin/verdict/overlay/test - Test light overlay
 * GET /api/admin/verdict/stability/test - Test stability guard (Block 5)
 */

import { FastifyInstance } from 'fastify';
import { heavyVerdictStore } from '../runtime/heavy-verdict.store.js';
import { heavyVerdictJob } from '../jobs/heavy-verdict.job.js';
import { heavyVerdictRefreshJob } from '../jobs/heavy-verdict.refresh.job.js';
import { lightOverlayService } from '../runtime/light-overlay.service.js';
import { overlayInputsBuilder } from '../runtime/overlay.inputs.builder.js';
import { verdictStabilityGuard } from '../runtime/verdict-stability.guard.js';
import { mlMicroCache } from '../runtime/ml-micro-cache.service.js';
import { requestCoalescer } from '../../shared/runtime/request-coalescer.js';
import { cacheMetricsService } from '../../shared/runtime/cache-metrics.service.js';
import { normalizeSymbol } from '../../shared/runtime/symbol-normalizer.js';

export async function verdictCacheAdminRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/admin/verdict-cache/stats
   * Get cache statistics
   */
  fastify.get('/api/admin/verdict-cache/stats', async () => {
    const cacheStats = heavyVerdictStore.stats();
    const jobStatus = heavyVerdictJob.status();
    const refreshJobStatus = heavyVerdictRefreshJob.status();
    const mlCacheStats = mlMicroCache.stats();
    const stabilityStats = verdictStabilityGuard.stats();
    const coalescerSize = requestCoalescer.size();

    return {
      ok: true,
      cache: cacheStats,
      mlCache: mlCacheStats,
      stability: stabilityStats,
      warmupJob: jobStatus,
      refreshJob: refreshJobStatus,
      coalescer: {
        inFlight: coalescerSize,
        keys: requestCoalescer.keys(),
      },
    };
  });

  /**
   * GET /api/admin/verdict-cache/metrics (Block 16)
   * Full metrics and observability data
   */
  fastify.get('/api/admin/verdict-cache/metrics', async () => {
    const metrics = cacheMetricsService.getMetrics();
    return {
      ok: true,
      ...metrics,
    };
  });

  /**
   * GET /api/admin/verdict-cache/health (Block 16)
   * Quick health summary
   */
  fastify.get('/api/admin/verdict-cache/health', async () => {
    const summary = cacheMetricsService.getSummary();
    return {
      ok: true,
      ...summary,
    };
  });

  /**
   * POST /api/admin/verdict-cache/invalidate
   * Invalidate cache entries by key or prefix
   */
  fastify.post<{
    Body: {
      key?: string;
      prefix?: string;
      symbol?: string;
      all?: boolean;
    };
  }>('/api/admin/verdict-cache/invalidate', async (request, reply) => {
    const body = request.body || {};

    if (body.all) {
      heavyVerdictStore.clear();
      mlMicroCache.clear();
      verdictStabilityGuard.clear();
      return { ok: true, message: 'All caches cleared' };
    }

    // Block 14: Use normalized symbol
    if (body.symbol) {
      const normalized = normalizeSymbol(body.symbol);
      const prefix = `symbol:${normalized}`;
      const removed = heavyVerdictStore.deleteByPrefix(prefix);
      verdictStabilityGuard.clear(normalized);
      return {
        ok: true,
        removed,
        normalizedSymbol: normalized,
        pattern: prefix,
      };
    }

    if (!body.prefix && !body.key) {
      return reply.status(400).send({
        ok: false,
        error: 'prefix, key, symbol, or all=true required',
      });
    }

    const removed = body.key
      ? heavyVerdictStore.delete(body.key)
      : heavyVerdictStore.deleteByPrefix(body.prefix!);

    return {
      ok: true,
      removed,
      pattern: body.key || body.prefix,
    };
  });

  /**
   * POST /api/admin/verdict-cache/warmup
   * Trigger manual cache warmup
   */
  fastify.post<{
    Body: {
      symbols?: string[];
      horizons?: string[];
    };
  }>('/api/admin/verdict-cache/warmup', async (request) => {
    const body = request.body || {};

    // Run warmup asynchronously
    heavyVerdictJob.runNow().catch(e => {
      console.error('[Admin] Warmup error:', e);
    });

    return {
      ok: true,
      message: 'Warmup triggered',
      job: heavyVerdictJob.status(),
    };
  });

  /**
   * POST /api/admin/verdict-cache/prune
   * Prune expired cache entries
   */
  fastify.post('/api/admin/verdict-cache/prune', async () => {
    const heavyPruned = heavyVerdictStore.prune();
    const mlPruned = mlMicroCache.prune();
    return {
      ok: true,
      pruned: {
        heavy: heavyPruned,
        ml: mlPruned,
      },
      stats: heavyVerdictStore.stats(),
    };
  });

  /**
   * GET /api/admin/verdict/overlay/test
   * Test light overlay with sample inputs
   */
  fastify.get<{
    Querystring: {
      symbol?: string;
      raw?: string;
    };
  }>('/api/admin/verdict/overlay/test', async (request) => {
    const rawSymbol = request.query.symbol || 'BTC';
    const symbol = normalizeSymbol(rawSymbol); // Block 14
    const rawConfidence = parseFloat(request.query.raw || '0.55');

    // Get real-time inputs
    const inputs = await overlayInputsBuilder.build(symbol);

    // Apply overlay
    const result = lightOverlayService.apply(rawConfidence, inputs);

    return {
      ok: true,
      symbol,
      inputSymbol: rawSymbol,
      rawConfidence,
      inputs,
      result,
    };
  });

  /**
   * GET /api/admin/verdict/stability/test (Block 5)
   * Test stability guard with sample verdict
   */
  fastify.get<{
    Querystring: {
      symbol?: string;
      direction?: string;
      confidence?: string;
      action?: string;
    };
  }>('/api/admin/verdict/stability/test', async (request) => {
    const rawSymbol = request.query.symbol || 'BTC';
    const symbol = normalizeSymbol(rawSymbol);
    const direction = (request.query.direction || 'UP') as 'UP' | 'DOWN' | 'FLAT';
    const confidence = parseFloat(request.query.confidence || '0.55');
    const action = (request.query.action || 'BUY') as 'BUY' | 'SELL' | 'HOLD' | 'AVOID';

    const incoming = {
      symbol,
      ts: Date.now(),
      direction,
      confidenceAdjusted: confidence,
      expectedMovePctAdjusted: direction === 'UP' ? 0.03 : direction === 'DOWN' ? -0.03 : 0,
      action,
      positionSize: 0.1,
      macroRegime: 'NEUTRAL',
      riskLevel: 'MEDIUM' as const,
      fundingCrowdedness: 0.3,
    };

    const stabilized = verdictStabilityGuard.apply(incoming);

    return {
      ok: true,
      symbol,
      incoming: {
        direction,
        confidence,
        action,
      },
      stabilized: stabilized.stable,
      guardStats: verdictStabilityGuard.stats(),
    };
  });

  /**
   * GET /api/admin/verdict-cache/keys
   * List all cache keys
   */
  fastify.get('/api/admin/verdict-cache/keys', async () => {
    const heavyKeys = heavyVerdictStore.keys();
    const stabilityKeys = verdictStabilityGuard.stats().keys;
    return {
      ok: true,
      heavy: {
        count: heavyKeys.length,
        keys: heavyKeys,
      },
      stability: {
        count: stabilityKeys.length,
        keys: stabilityKeys,
      },
    };
  });

  /**
   * GET /api/admin/verdict/normalize (Block 14)
   * Test symbol normalization
   */
  fastify.get<{
    Querystring: {
      symbol?: string;
    };
  }>('/api/admin/verdict/normalize', async (request) => {
    const raw = request.query.symbol || 'BTCUSDT';
    const normalized = normalizeSymbol(raw);
    return {
      ok: true,
      raw,
      normalized,
    };
  });

  console.log('[VerdictCacheAdmin] Routes registered (Blocks 5, 9, 14, 15, 16)');
}

export default verdictCacheAdminRoutes;
