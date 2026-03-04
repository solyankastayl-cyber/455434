/**
 * Negative Sample API Routes
 * 
 * EPIC 8: Admin endpoints for negative sample pipeline
 * 
 * POST /api/ml-negative/run - Run pipeline
 * GET /api/ml-negative/status - Get run status
 * GET /api/ml-negative/report - Get detailed report
 * GET /api/ml-negative/stats - Get overall statistics
 */

import type { FastifyPluginAsync } from 'fastify';
import { 
  runNegativePipeline, 
  getRunStatus, 
  getRecentRuns,
  getSampleStats 
} from './negative_pipeline.runner.js';
import { getSamplesByRun } from './negative.store.js';
import { getAuditLogsForRun, getRecentAuditLogs } from './negative.audit.js';
import type { NegativeRunConfig } from './negative.types.js';

export const negativeRoutes: FastifyPluginAsync = async (app) => {
  // Run negative sample pipeline
  app.post('/run', async (req, reply) => {
    const body = req.body as Partial<NegativeRunConfig>;
    
    const config: NegativeRunConfig = {
      horizon: (body.horizon as '7d' | '14d') || '7d',
      window: (body.window as '7d' | '14d') || '7d',
      maxCandidates: body.maxCandidates || 5000,
      targetSamples: body.targetSamples || 2000,
      dryRun: body.dryRun ?? false,
    };
    
    try {
      const stats = await runNegativePipeline(config);
      
      return reply.send({
        ok: true,
        data: stats,
      });
    } catch (err) {
      app.log.error(err);
      return reply.status(500).send({
        ok: false,
        error: 'PIPELINE_FAILED',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
  
  // Get run status
  app.get('/status', async (req, reply) => {
    const query = req.query as { runId?: string };
    
    if (!query.runId) {
      // Return latest run status
      const recent = await getRecentRuns(1);
      if (recent.length === 0) {
        return reply.send({ ok: true, data: null, message: 'No runs found' });
      }
      
      const status = await getRunStatus(recent[0].runId);
      return reply.send({ ok: true, data: status });
    }
    
    const status = await getRunStatus(query.runId);
    if (!status) {
      return reply.status(404).send({
        ok: false,
        error: 'RUN_NOT_FOUND',
        message: `Run ${query.runId} not found`,
      });
    }
    
    return reply.send({ ok: true, data: status });
  });
  
  // Get detailed report for a run
  app.get('/report', async (req, reply) => {
    const query = req.query as { runId?: string; limit?: string };
    
    let runId = query.runId;
    
    // Get latest run if not specified
    if (!runId) {
      const recent = await getRecentRuns(1);
      if (recent.length === 0) {
        return reply.send({ ok: true, data: null, message: 'No runs found' });
      }
      runId = recent[0].runId;
    }
    
    const limit = Math.min(parseInt(query.limit || '100', 10), 500);
    
    const [status, samples, auditLogs] = await Promise.all([
      getRunStatus(runId),
      getSamplesByRun(runId, limit),
      getAuditLogsForRun(runId, 50),
    ]);
    
    if (!status) {
      return reply.status(404).send({
        ok: false,
        error: 'RUN_NOT_FOUND',
        message: `Run ${runId} not found`,
      });
    }
    
    // Sample distribution analysis
    const samplesByType = samples.reduce((acc, s) => {
      const type = s.negativeType || 'POSITIVE';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    // Top reasons
    const reasonCounts = samples.reduce((acc, s) => {
      acc[s.labelReason] = (acc[s.labelReason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return reply.send({
      ok: true,
      data: {
        status,
        samplesByType,
        reasonCounts,
        auditLogs,
        recentSamples: samples.slice(0, 10),
      },
    });
  });
  
  // Get overall statistics
  app.get('/stats', async (_req, reply) => {
    const stats = await getSampleStats();
    const recentRuns = await getRecentRuns(5);
    
    return reply.send({
      ok: true,
      data: {
        ...stats,
        recentRuns: recentRuns.map(r => ({
          runId: r.runId,
          status: r.status,
          samplesGenerated: r.samplesGenerated,
          negPosRatio: r.negPosRatio,
          startedAt: r.startedAt,
        })),
      },
    });
  });
  
  // Get run history
  app.get('/history', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    
    const runs = await getRecentRuns(limit);
    
    return reply.send({
      ok: true,
      data: runs,
      count: runs.length,
    });
  });
  
  // Get audit logs
  app.get('/audit', async (req, reply) => {
    const query = req.query as { hours?: string; limit?: string };
    const hours = parseInt(query.hours || '24', 10);
    const limit = Math.min(parseInt(query.limit || '200', 10), 500);
    
    const logs = await getRecentAuditLogs(hours, limit);
    
    return reply.send({
      ok: true,
      data: logs,
      count: logs.length,
    });
  });
};
