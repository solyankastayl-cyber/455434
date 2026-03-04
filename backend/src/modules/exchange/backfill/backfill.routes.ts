/**
 * PHASE 1.3 — Backfill Routes
 * ============================
 * Admin API for historical data backfill
 */

import { FastifyInstance } from 'fastify';
import { backfillService } from './backfill.service.js';
import { BackfillRequest } from './backfill.types.js';

export async function registerBackfillRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/backfill/start — Start backfill job
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: BackfillRequest }>(
    '/api/v10/exchange/backfill/start',
    async (request) => {
      const body = request.body ?? {};
      
      const req: BackfillRequest = {
        symbols: body.symbols ?? ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
        days: body.days ?? 7,
        timeframe: body.timeframe ?? '5m',
        provider: body.provider ?? 'BYBIT',
        horizonBars: body.horizonBars ?? 6,
        dryRun: body.dryRun ?? false,
      };
      
      // Validation
      if (req.days < 1 || req.days > 30) {
        return { ok: false, error: 'days must be between 1 and 30' };
      }
      
      if (!['1m', '5m', '15m'].includes(req.timeframe)) {
        return { ok: false, error: 'timeframe must be 1m, 5m, or 15m' };
      }
      
      const { runId } = await backfillService.start(req);
      
      return {
        ok: true,
        runId,
        message: `Started backfill: ${req.symbols.join(',')} | ${req.days}d | ${req.timeframe}`,
        request: req,
      };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/backfill/status/:runId — Get status
  // ─────────────────────────────────────────────────────────────
  fastify.get<{ Params: { runId: string } }>(
    '/api/v10/exchange/backfill/status/:runId',
    async (request) => {
      const { runId } = request.params;
      const status = backfillService.getStatus(runId);
      
      if (!status) {
        return { ok: false, error: 'Run not found' };
      }
      
      return { ok: true, ...status };
    }
  );
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/v10/exchange/backfill/runs — List all runs
  // ─────────────────────────────────────────────────────────────
  fastify.get('/api/v10/exchange/backfill/runs', async () => {
    const runs = backfillService.listRuns();
    
    return {
      ok: true,
      count: runs.length,
      runs: runs.map(r => ({
        runId: r.runId,
        state: r.state,
        symbols: r.request.symbols,
        days: r.request.days,
        timeframe: r.request.timeframe,
        progress: `${r.progress.symbolsDone}/${r.progress.symbolsTotal} symbols`,
        barsProcessed: r.progress.barsProcessed,
        observations: r.progress.observationsCreated,
        truths: r.progress.truthsCreated,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    };
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/v10/exchange/backfill/cancel/:runId — Cancel run
  // ─────────────────────────────────────────────────────────────
  fastify.post<{ Params: { runId: string } }>(
    '/api/v10/exchange/backfill/cancel/:runId',
    async (request) => {
      const { runId } = request.params;
      const status = await backfillService.cancel(runId);
      
      if (!status) {
        return { ok: false, error: 'Run not found' };
      }
      
      return {
        ok: true,
        message: 'Backfill cancelled',
        status,
      };
    }
  );
  
  console.log('[Phase 1.3] Backfill Routes registered');
}
