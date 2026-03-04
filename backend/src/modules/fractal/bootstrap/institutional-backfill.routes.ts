/**
 * BLOCK 77.5 — Institutional Backfill Routes
 * BLOCK 77.6 — VINTAGE Cohort Support (V2014, V2020)
 * 
 * API endpoints for production-grade 2014-2025 backfill.
 * 
 * Endpoints:
 * - POST /api/fractal/v2.1/admin/backfill/start - Start backfill (supports cohort)
 * - POST /api/fractal/v2.1/admin/backfill/resume - Resume paused job
 * - POST /api/fractal/v2.1/admin/backfill/stop - Stop running job
 * - GET /api/fractal/v2.1/admin/backfill/progress - Get current progress
 * - GET /api/fractal/v2.1/admin/backfill/jobs - Get all jobs
 * - GET /api/fractal/v2.1/admin/backfill/stats - Get backfill statistics
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { institutionalBackfillService, CohortType } from './institutional-backfill.service.js';

interface BackfillStartBody {
  cohort?: CohortType;     // BLOCK 77.6: V2014 | V2020
  rangeTag?: string;       // BLOCK 77.6: '2014-2019' | '2020-2025'
  yearStart?: number;
  yearEnd?: number;
  horizons?: string[];
  presets?: string[];
  roles?: string[];
  policyHash?: string;
  chunkSize?: number;
  throttleMs?: number;
}

interface BackfillResumeBody {
  jobId: string;
}

export async function institutionalBackfillRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * POST /api/fractal/v2.1/admin/backfill/start
   * 
   * Start institutional backfill
   * BLOCK 77.6: Supports cohort parameter (V2014 for 2014-2019, V2020 for 2020-2025)
   */
  fastify.post('/api/fractal/v2.1/admin/backfill/start', async (
    request: FastifyRequest<{ Body: BackfillStartBody }>
  ) => {
    try {
      const body = request.body || {};
      
      const progress = await institutionalBackfillService.startFullBackfill({
        cohort: body.cohort,
        rangeTag: body.rangeTag,
        yearStart: body.yearStart,
        yearEnd: body.yearEnd,
        horizons: body.horizons,
        presets: body.presets,
        roles: body.roles,
        policyHash: body.policyHash,
        chunkSize: body.chunkSize,
        throttleMs: body.throttleMs,
      });
      
      return {
        ok: true,
        message: `Institutional backfill started (cohort: ${progress.cohort})`,
        jobId: progress.jobId,
        cohort: progress.cohort,
        rangeTag: progress.rangeTag,
        totalBatches: progress.totalBatches,
        batches: progress.batches.map(b => b.rangeId),
      };
      
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/backfill/resume
   * 
   * Resume a paused or failed backfill job
   */
  fastify.post('/api/fractal/v2.1/admin/backfill/resume', async (
    request: FastifyRequest<{ Body: BackfillResumeBody }>
  ) => {
    try {
      const { jobId } = request.body || {};
      
      if (!jobId) {
        return { ok: false, error: 'jobId required' };
      }
      
      const progress = await institutionalBackfillService.resumeBackfill(jobId);
      
      if (!progress) {
        return { ok: false, error: 'Job not found' };
      }
      
      return {
        ok: true,
        message: 'Backfill resumed',
        progress,
      };
      
    } catch (err: any) {
      return {
        ok: false,
        error: err.message,
      };
    }
  });
  
  /**
   * POST /api/fractal/v2.1/admin/backfill/stop
   * 
   * Stop a running backfill job
   */
  fastify.post('/api/fractal/v2.1/admin/backfill/stop', async () => {
    await institutionalBackfillService.stopBackfill();
    
    return {
      ok: true,
      message: 'Stop requested - job will pause after current batch',
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/backfill/progress
   * 
   * Get current or specific job progress
   */
  fastify.get('/api/fractal/v2.1/admin/backfill/progress', async (
    request: FastifyRequest<{ Querystring: { jobId?: string } }>
  ) => {
    const jobId = request.query.jobId;
    const progress = await institutionalBackfillService.getProgress(jobId);
    
    if (!progress) {
      return {
        ok: true,
        progress: null,
        message: 'No backfill jobs found',
      };
    }
    
    // Calculate estimated time
    let estimatedRemaining = '';
    if (progress.status === 'RUNNING' && progress.completedBatches > 0) {
      const elapsed = Date.now() - new Date(progress.startedAt).getTime();
      const avgPerBatch = elapsed / progress.completedBatches;
      const remaining = (progress.totalBatches - progress.completedBatches) * avgPerBatch;
      const minutes = Math.round(remaining / 60000);
      estimatedRemaining = minutes > 60 
        ? `~${Math.round(minutes / 60)}h ${minutes % 60}m`
        : `~${minutes}m`;
    }
    
    return {
      ok: true,
      progress: {
        ...progress,
        estimatedRemaining,
        percentComplete: progress.totalBatches > 0 
          ? Math.round(progress.completedBatches / progress.totalBatches * 100)
          : 0,
      },
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/backfill/jobs
   * 
   * Get all backfill jobs
   * BLOCK 77.6: Includes cohort in response
   */
  fastify.get('/api/fractal/v2.1/admin/backfill/jobs', async () => {
    const jobs = await institutionalBackfillService.getAllJobs();
    
    return {
      ok: true,
      count: jobs.length,
      jobs: jobs.map(j => ({
        jobId: j.jobId,
        cohort: j.cohort,
        rangeTag: j.rangeTag,
        status: j.status,
        completedBatches: j.completedBatches,
        totalBatches: j.totalBatches,
        totalSnapshots: j.totalSnapshots,
        totalOutcomes: j.totalOutcomes,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
      })),
    };
  });
  
  /**
   * GET /api/fractal/v2.1/admin/backfill/stats
   * 
   * Get backfill data statistics
   * BLOCK 77.6: Optional cohort filter
   */
  fastify.get('/api/fractal/v2.1/admin/backfill/stats', async (
    request: FastifyRequest<{ Querystring: { cohort?: CohortType } }>
  ) => {
    const cohort = request.query.cohort;
    const stats = await institutionalBackfillService.getBackfillStats(cohort);
    
    return {
      ok: true,
      cohortFilter: cohort || 'ALL',
      stats: {
        ...stats,
        hitRatePct: (stats.hitRate * 100).toFixed(1) + '%',
        avgReturnPct: stats.avgReturn.toFixed(2) + '%',
      },
    };
  });
  
  fastify.log.info('[Fractal] BLOCK 77.5/77.6: Institutional Backfill routes registered (with cohort support)');
}

export default institutionalBackfillRoutes;
