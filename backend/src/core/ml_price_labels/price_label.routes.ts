/**
 * Price Label API Routes
 * 
 * EPIC 9: Endpoints for price label pipeline
 */

import type { FastifyPluginAsync } from 'fastify';
import { 
  runPriceLabelPipeline, 
  getLabelRunStatus, 
  getRecentLabelRuns,
  getPriceLabelStats 
} from './price_label_pipeline.runner.js';
import { getLabelsByToken } from './price_label.store.js';
import type { PriceLabelRunConfig } from './price_label.types.js';

export const priceLabelRoutes: FastifyPluginAsync = async (app) => {
  // Run price label pipeline
  app.post('/run', async (req, reply) => {
    const body = req.body as Partial<PriceLabelRunConfig>;
    
    const config: PriceLabelRunConfig = {
      maxSignals: body.maxSignals || 5000,
      priceSource: body.priceSource || 'aggregated',
      dryRun: body.dryRun ?? false,
      startDate: body.startDate ? new Date(body.startDate as unknown as string) : undefined,
      endDate: body.endDate ? new Date(body.endDate as unknown as string) : undefined,
    };
    
    try {
      const stats = await runPriceLabelPipeline(config);
      return reply.send({ ok: true, data: stats });
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
      const recent = await getRecentLabelRuns(1);
      if (recent.length === 0) {
        return reply.send({ ok: true, data: null, message: 'No runs found' });
      }
      
      const status = await getLabelRunStatus(recent[0].runId);
      return reply.send({ ok: true, data: status });
    }
    
    const status = await getLabelRunStatus(query.runId);
    if (!status) {
      return reply.status(404).send({
        ok: false,
        error: 'RUN_NOT_FOUND',
      });
    }
    
    return reply.send({ ok: true, data: status });
  });
  
  // Get overall statistics
  app.get('/stats', async (_req, reply) => {
    const stats = await getPriceLabelStats();
    const recentRuns = await getRecentLabelRuns(5);
    
    return reply.send({
      ok: true,
      data: {
        ...stats,
        recentRuns: recentRuns.map(r => ({
          runId: r.runId,
          status: r.status,
          labelsGenerated: r.labelsGenerated,
          positiveRatio: r.positiveRatio,
          startedAt: r.startedAt,
        })),
      },
    });
  });
  
  // Get run history
  app.get('/history', async (req, reply) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '20', 10), 100);
    
    const runs = await getRecentLabelRuns(limit);
    
    return reply.send({
      ok: true,
      data: runs,
      count: runs.length,
    });
  });
  
  // Get labels for specific token
  app.get('/token/:address', async (req, reply) => {
    const params = req.params as { address: string };
    const query = req.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit || '50', 10), 200);
    
    const labels = await getLabelsByToken(params.address, limit);
    
    return reply.send({
      ok: true,
      data: labels,
      count: labels.length,
    });
  });
};
