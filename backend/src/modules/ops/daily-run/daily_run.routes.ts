/**
 * L4.1 — Daily Run Routes
 * 
 * API endpoints for daily pipeline orchestration
 */

import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { getDailyRunOrchestrator } from './daily_run.orchestrator.js';
import type { DailyRunAsset } from './daily_run.types.js';

export async function registerDailyRunRoutes(app: FastifyInstance): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) {
    console.error('[DailyRun] MongoDB not connected');
    return;
  }
  
  const orchestrator = getDailyRunOrchestrator(db);
  
  /**
   * POST /api/ops/daily-run/run-now
   * 
   * Run daily pipeline for specified asset
   * Query: ?asset=BTC|SPX
   */
  app.post<{
    Querystring: { asset?: string };
  }>('/api/ops/daily-run/run-now', async (req, reply) => {
    try {
      const asset = (req.query.asset || 'BTC').toUpperCase() as DailyRunAsset;
      
      if (asset !== 'BTC' && asset !== 'SPX' && asset !== 'DXY') {
        return reply.code(400).send({ ok: false, error: 'asset must be BTC, SPX, or DXY' });
      }
      
      console.log(`[DailyRun] Run-now triggered for ${asset}`);
      
      const result = await orchestrator.runPipeline(asset);
      
      return { ok: result.ok, data: result };
    } catch (err: any) {
      console.error('[DailyRun] Run-now error:', err);
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/ops/daily-run/status
   * 
   * Get last run status for asset
   */
  app.get<{
    Querystring: { asset?: string };
  }>('/api/ops/daily-run/status', async (req, reply) => {
    try {
      const asset = (req.query.asset || 'BTC').toUpperCase();
      
      // Get last DAILY_RUN_COMPLETED event
      const lastEvent = await db.collection('model_lifecycle_events')
        .find({ modelId: asset, type: 'DAILY_RUN_COMPLETED' })
        .sort({ ts: -1 })
        .limit(1)
        .toArray();
      
      if (lastEvent.length === 0) {
        return { ok: true, data: { lastRun: null } };
      }
      
      return { ok: true, data: { lastRun: lastEvent[0] } };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  /**
   * GET /api/ops/daily-run/history
   * 
   * Get run history for asset
   */
  app.get<{
    Querystring: { asset?: string; limit?: string };
  }>('/api/ops/daily-run/history', async (req, reply) => {
    try {
      const asset = (req.query.asset || 'BTC').toUpperCase();
      const limit = parseInt(req.query.limit || '10', 10);
      
      const events = await db.collection('model_lifecycle_events')
        .find({ modelId: asset, type: 'DAILY_RUN_COMPLETED' })
        .sort({ ts: -1 })
        .limit(limit)
        .toArray();
      
      return { ok: true, data: events };
    } catch (err: any) {
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
  
  console.log('[DailyRun] Routes registered at /api/ops/daily-run/*');
}

export default registerDailyRunRoutes;
