/**
 * P5-FINAL: Admin Jobs & Health Routes
 * 
 * Endpoints:
 * - POST /api/admin/jobs/run - Run scheduled jobs
 * - GET /api/admin/health/status - Get model health
 * - POST /api/admin/health/recompute - Recompute health grades
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { runResolveJob } from '../jobs/resolve_matured_snapshots.job.js';
import { 
  computeHealth, 
  computeAllHealth, 
  isGovernanceFrozen, 
  HealthStore,
  type Scope 
} from '../health/model_health.service.js';
import { 
  runSeedBacktest, 
  getSeedStats, 
  clearSeedData,
  type SeedBacktestParams 
} from '../fractal/services/seed-backtest.service.js';

interface JobQuery {
  job: string;
  scope?: string;
}

interface SeedQuery {
  scope: string;
  from?: string;
  to?: string;
  stepDays?: string;
  limit?: string;
}

interface HealthQuery {
  scope?: string;
}

export async function adminJobsRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ═══════════════════════════════════════════════════════════════
  // JOBS
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * POST /api/admin/jobs/run
   * 
   * Run a scheduled job manually
   */
  fastify.post('/api/admin/jobs/run', async (
    request: FastifyRequest<{ Querystring: JobQuery }>
  ) => {
    const job = request.query.job;
    
    switch (job) {
      case 'resolve_matured':
      case 'resolve':
        const resolveResult = await runResolveJob();
        return {
          ok: resolveResult.ok,
          job: 'resolve_matured',
          result: resolveResult,
        };
        
      case 'health_check':
      case 'health':
        const healthResults = await computeAllHealth();
        return {
          ok: true,
          job: 'health_check',
          results: healthResults.map(r => ({
            scope: r.scope,
            grade: r.state.grade,
            gradeChanged: r.gradeChanged,
            sampleCount: r.state.metrics.sampleCount,
          })),
        };
        
      case 'full':
        // Run resolve then health check
        const resolve = await runResolveJob();
        const health = await computeAllHealth();
        return {
          ok: true,
          job: 'full',
          resolve: {
            totalResolved: resolve.totalResolved,
            durationMs: resolve.durationMs,
          },
          health: health.map(r => ({
            scope: r.scope,
            grade: r.state.grade,
          })),
        };
        
      case 'seed_backtest':
        // Run seed backtest to generate historical data
        const scope = (request.query as any).scope?.toUpperCase() || 'BTC';
        const seedParams: SeedBacktestParams = {
          scope: scope as 'BTC' | 'SPX' | 'DXY',
          from: (request.query as any).from || '2022-01-01',
          to: (request.query as any).to || '2024-01-01',
          stepDays: parseInt((request.query as any).stepDays || '7'),
          horizons: ['7d', '14d', '30d'],
          limit: parseInt((request.query as any).limit || '200'),
        };
        const seedResult = await runSeedBacktest(seedParams);
        return {
          ok: seedResult.ok,
          job: 'seed_backtest',
          result: seedResult,
        };
        
      default:
        return { 
          ok: false, 
          error: `Unknown job: ${job}. Available: resolve_matured, health_check, full, seed_backtest` 
        };
    }
  });
  
  /**
   * GET /api/admin/jobs/seed/stats
   * 
   * Get seed data statistics
   */
  fastify.get('/api/admin/jobs/seed/stats', async (
    request: FastifyRequest<{ Querystring: { scope?: string } }>
  ) => {
    const scope = request.query.scope?.toUpperCase() || 'BTC';
    const stats = await getSeedStats(scope);
    return { ok: true, scope, ...stats };
  });
  
  /**
   * GET /api/admin/jobs/seed/metrics
   * 
   * Get per-horizon metrics from seed data
   */
  fastify.get('/api/admin/jobs/seed/metrics', async (
    request: FastifyRequest<{ Querystring: { scope?: string } }>
  ) => {
    const scope = request.query.scope?.toUpperCase() || 'BTC';
    const { getSeedMetrics } = await import('../fractal/services/seed-metrics.service.js');
    const metrics = await getSeedMetrics(scope);
    return { ok: true, ...metrics };
  });
  
  /**
   * GET /api/admin/jobs/seed/distribution
   * 
   * Get error distribution histogram from seed data
   */
  fastify.get('/api/admin/jobs/seed/distribution', async (
    request: FastifyRequest<{ Querystring: { scope?: string; bins?: string } }>
  ) => {
    const scope = request.query.scope?.toUpperCase() || 'BTC';
    const bins = parseInt(request.query.bins || '20');
    const { getErrorDistribution } = await import('../fractal/services/seed-metrics.service.js');
    const distribution = await getErrorDistribution(scope, bins);
    return { ok: true, ...distribution };
  });
  
  /**
   * DELETE /api/admin/jobs/seed/clear
   * 
   * Clear seed data for a scope
   */
  fastify.delete('/api/admin/jobs/seed/clear', async (
    request: FastifyRequest<{ Querystring: { scope?: string } }>
  ) => {
    const scope = request.query.scope?.toUpperCase();
    const result = await clearSeedData(scope);
    return { ok: true, scope: scope || 'ALL', ...result };
  });
  
  /**
   * GET /api/admin/jobs/list
   * 
   * List available jobs
   */
  fastify.get('/api/admin/jobs/list', async () => {
    return {
      ok: true,
      jobs: [
        { name: 'resolve_matured', description: 'Resolve all matured snapshots into outcomes' },
        { name: 'health_check', description: 'Recompute health grades for all scopes' },
        { name: 'full', description: 'Run resolve_matured then health_check' },
        { name: 'seed_backtest', description: 'Generate historical snapshots with outcomes (seed data)', params: ['scope', 'from', 'to', 'stepDays', 'limit'] },
      ],
    };
  });
  
  // ═══════════════════════════════════════════════════════════════
  // HEALTH
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * GET /api/admin/health/status
   * 
   * Get health status for all or specific scope
   */
  fastify.get('/api/admin/health/status', async (
    request: FastifyRequest<{ Querystring: HealthQuery }>
  ) => {
    const scope = request.query.scope?.toUpperCase() as Scope | undefined;
    
    if (scope) {
      const state = await HealthStore.getState(scope);
      if (!state) {
        return { ok: false, error: `No health state for ${scope}. Run health_check job first.` };
      }
      return { ok: true, scope, state };
    }
    
    // Return all
    const states = await HealthStore.getAllStates();
    return {
      ok: true,
      states,
      summary: {
        total: states.length,
        healthy: states.filter(s => s.grade === 'HEALTHY').length,
        degraded: states.filter(s => s.grade === 'DEGRADED').length,
        critical: states.filter(s => s.grade === 'CRITICAL').length,
      },
    };
  });
  
  /**
   * POST /api/admin/health/recompute
   * 
   * Recompute health for specific scope or all
   */
  fastify.post('/api/admin/health/recompute', async (
    request: FastifyRequest<{ Querystring: HealthQuery }>
  ) => {
    const scope = request.query.scope?.toUpperCase() as Scope | undefined;
    
    if (scope) {
      const result = await computeHealth(scope);
      return {
        ok: true,
        scope,
        grade: result.state.grade,
        gradeChanged: result.gradeChanged,
        previousGrade: result.previousGrade,
        metrics: result.state.metrics,
      };
    }
    
    // Recompute all
    const results = await computeAllHealth();
    return {
      ok: true,
      results: results.map(r => ({
        scope: r.scope,
        grade: r.state.grade,
        gradeChanged: r.gradeChanged,
        sampleCount: r.state.metrics.sampleCount,
      })),
    };
  });
  
  /**
   * GET /api/admin/health/frozen
   * 
   * Check if governance is frozen for a scope
   */
  fastify.get('/api/admin/health/frozen', async (
    request: FastifyRequest<{ Querystring: HealthQuery }>
  ) => {
    const scope = (request.query.scope?.toUpperCase() || 'BTC') as Scope;
    const result = await isGovernanceFrozen(scope);
    return { ok: true, scope, ...result };
  });
  
  console.log('[Admin] Jobs & Health routes registered at /api/admin/*');
}

export default adminJobsRoutes;
