/**
 * BLOCK 77.4 — Bootstrap Routes
 * 
 * API endpoints for Historical Bootstrap Engine.
 * 
 * Endpoints:
 * - POST /api/fractal/v2.1/admin/bootstrap/run - Start backfill job
 * - POST /api/fractal/v2.1/admin/bootstrap/resolve - Resolve outcomes
 * - GET /api/fractal/v2.1/admin/bootstrap/stats - Get bootstrap statistics
 * - GET /api/fractal/v2.1/admin/bootstrap/progress - Get current progress
 * - DELETE /api/fractal/v2.1/admin/bootstrap/clear - Clear bootstrap data
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { bootstrapService } from './bootstrap.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface BootstrapRunBody {
  symbol?: string;
  from?: string;
  to?: string;
  horizons?: string[];
  presets?: string[];
  roles?: string[];
  policyHash?: string;
}

interface BootstrapResolveBody {
  symbol?: string;
  batchId?: string;
  forceResolve?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

export async function bootstrapRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/bootstrap/run
   * 
   * Start historical backfill job
   * Creates snapshots for all dates in range with source='BOOTSTRAP'
   */
  fastify.post('/api/fractal/v2.1/admin/bootstrap/run', async (
    request: FastifyRequest<{ Body: BootstrapRunBody }>
  ) => {
    const body = request.body || {};
    
    const input = {
      symbol: 'BTC' as const,
      from: body.from || '2023-01-01',
      to: body.to || '2025-12-31',
      horizons: body.horizons || ['7d', '14d', '30d', '90d', '180d', '365d'],
      presets: body.presets || ['conservative', 'balanced', 'aggressive'],
      roles: body.roles || ['ACTIVE', 'SHADOW'],
      policyHash: body.policyHash || 'v2.1.0',
      engineVersion: 'v2.1.0',
    };
    
    // Validate dates
    if (input.from > input.to) {
      return { error: true, message: 'from date must be before to date' };
    }
    
    fastify.log.info({ input }, '[Bootstrap] Starting run');
    
    // Run async (non-blocking)
    const progressPromise = bootstrapService.runBootstrap(input);
    
    // Return immediately with batch ID
    return {
      ok: true,
      message: 'Bootstrap job started',
      batchId: (await progressPromise).batchId,
      input,
    };
  });
  
  /**
   * POST /api/fractal/v2.1/admin/bootstrap/resolve
   * 
   * Resolve bootstrap outcomes using historical price data
   */
  fastify.post('/api/fractal/v2.1/admin/bootstrap/resolve', async (
    request: FastifyRequest<{ Body: BootstrapResolveBody }>
  ) => {
    const body = request.body || {};
    
    const input = {
      symbol: 'BTC' as const,
      batchId: body.batchId,
      forceResolve: body.forceResolve || false,
    };
    
    fastify.log.info({ input }, '[Bootstrap] Starting resolution');
    
    // Run resolution
    const progress = await bootstrapService.resolveBootstrapOutcomes(input);
    
    return {
      ok: progress.status === 'COMPLETED',
      progress,
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/bootstrap/stats
   * 
   * Get bootstrap data statistics
   */
  fastify.get('/api/fractal/v2.1/admin/bootstrap/stats', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    
    const stats = await bootstrapService.getStats(symbol);
    
    return {
      ok: true,
      stats,
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/bootstrap/progress
   * 
   * Get current job progress
   */
  fastify.get('/api/fractal/v2.1/admin/bootstrap/progress', async () => {
    const runProgress = bootstrapService.getProgress();
    const resolveProgress = bootstrapService.getResolveProgress();
    
    return {
      ok: true,
      run: runProgress,
      resolve: resolveProgress,
    };
  });
  
  /**
   * DELETE /api/fractal/v2.1/admin/bootstrap/clear
   * 
   * Clear all bootstrap data (for testing/reset)
   */
  fastify.delete('/api/fractal/v2.1/admin/bootstrap/clear', async (
    request: FastifyRequest<{ Querystring: { symbol?: string; confirm?: string } }>
  ) => {
    const symbol = request.query.symbol || 'BTC';
    const confirm = request.query.confirm;
    
    if (confirm !== 'yes') {
      return {
        ok: false,
        error: 'CONFIRMATION_REQUIRED',
        message: 'Add ?confirm=yes to confirm deletion',
      };
    }
    
    const result = await bootstrapService.clearBootstrapData(symbol);
    
    fastify.log.warn({ symbol, result }, '[Bootstrap] Data cleared');
    
    return {
      ok: true,
      deleted: result,
    };
  });
  
  fastify.log.info('[Fractal] BLOCK 77.4: Bootstrap routes registered');
}

export default bootstrapRoutes;
