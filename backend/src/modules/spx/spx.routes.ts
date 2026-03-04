/**
 * SPX TERMINAL — API Routes
 * 
 * BLOCK B1-B4 — Full SPX Data Foundation Routes
 * 
 * Endpoints:
 * - GET  /api/spx/v2.1/info         - Product info
 * - GET  /api/spx/v2.1/status       - Build status
 * - GET  /api/spx/v2.1/stats        - Data statistics
 * - GET  /api/market-data/candles   - Query candles
 * 
 * Admin endpoints:
 * - POST /api/fractal/v2.1/admin/spx/ingest       - Ingest from Stooq
 * - POST /api/fractal/v2.1/admin/spx/backfill     - Backfill date range
 * - GET  /api/fractal/v2.1/admin/spx/backfill/status - Backfill progress
 * - POST /api/fractal/v2.1/admin/spx/backfill/reset  - Reset progress
 * - GET  /api/fractal/v2.1/admin/spx/validate     - Data validation
 * - GET  /api/fractal/v2.1/admin/spx/gaps         - Gap audit
 * - POST /api/fractal/v2.1/admin/spx/indexes      - Ensure indexes
 * - GET  /api/fractal/v2.1/admin/spx/cohorts      - Cohort counts
 * - GET  /api/fractal/v2.1/admin/spx/logs         - Ingestion logs
 */

import type { FastifyInstance } from 'fastify';
import SPX_CONFIG from './spx.config.js';
import { ingestSpxFromStooq, getIngestionLogs } from './spx.ingest.service.js';
import { runSpxBackfill, getBackfillProgress, resetBackfillProgress, getCohortCounts } from './spx.backfill.service.js';
import { validateSpxData, auditSpxGaps, getSpxStats } from './spx.validation.service.js';
import { querySpxCandles, getLatestSpxCandle } from './spx.candles.service.js';
import { ensureSpxIndexes, SpxCandleModel } from './spx.mongo.js';
import { ingestFromYahooCsv, replaceWithYahooCsv } from './spx.yahoo.ingest.js';
import { generateMockSpxCandles, generateFullSpxHistory } from './spx.mock.generator.js';
import type { SpxCohort } from './spx.types.js';

export async function registerSpxRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = SPX_CONFIG.apiPrefix;
  
  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/spx/v2.1/info
   * SPX Product info
   */
  fastify.get(`${prefix}/info`, async () => {
    const stats = await getSpxStats();
    return {
      product: 'SPX Terminal',
      version: SPX_CONFIG.contractVersion,
      symbol: SPX_CONFIG.symbol,
      frozen: SPX_CONFIG.frozen,
      status: SPX_CONFIG.status,
      horizons: SPX_CONFIG.horizons,
      governance: SPX_CONFIG.governance,
      dataSource: SPX_CONFIG.dataSource,
      description: 'Pure SPX Fractal Terminal - S&P 500 Index Analysis',
      data: stats,
    };
  });
  
  /**
   * GET /api/spx/v2.1/status
   * SPX Build status with data status
   */
  fastify.get(`${prefix}/status`, async () => {
    const stats = await getSpxStats();
    const hasData = stats.count > 0;
    const hasCohorts = Object.keys(stats.cohorts || {}).length > 0;
    
    return {
      ok: true,
      product: 'SPX Terminal',
      status: SPX_CONFIG.status,
      progress: {
        config: true,
        routes: true,
        dataAdapter: true,
        backfill: hasData,
        cohorts: hasCohorts,
        horizons: false,
        consensus: false,
        governance: false,
        ui: false,
      },
      data: stats,
      nextStep: hasData 
        ? 'Implement SPX Fractal Core (horizons/phases/consensus)'
        : 'Run SPX backfill to ingest historical data',
    };
  });

  /**
   * GET /api/spx/v2.1/stats
   * SPX Data statistics
   */
  fastify.get(`${prefix}/stats`, async () => {
    return await getSpxStats();
  });

  /**
   * GET /api/spx/v2.1/terminal
   * SPX Terminal (will be full terminal later)
   */
  fastify.get(`${prefix}/terminal`, async () => {
    const stats = await getSpxStats();
    const latest = await getLatestSpxCandle();
    
    return {
      ok: stats.count > 0,
      status: SPX_CONFIG.status,
      message: stats.count > 0 
        ? 'SPX data available. Fractal core pending.'
        : 'SPX data not yet loaded. Run backfill first.',
      symbol: SPX_CONFIG.symbol,
      data: {
        count: stats.count,
        range: stats.range,
        cohorts: stats.cohorts,
        latest: latest ? {
          date: latest.date,
          close: latest.close,
          cohort: latest.cohort,
        } : null,
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // MARKET DATA API
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /api/market-data/candles
   * Query SPX candles
   */
  fastify.get('/api/market-data/candles', async (req, reply) => {
    const q = req.query as any;

    if (q.symbol !== 'SPX') {
      return reply.code(400).send({ ok: false, error: 'symbol must be SPX' });
    }
    if (q.source && q.source !== 'stooq') {
      return reply.code(400).send({ ok: false, error: 'source must be stooq' });
    }
    if (q.tf && q.tf !== '1d') {
      return reply.code(400).send({ ok: false, error: 'tf must be 1d' });
    }

    const rows = await querySpxCandles({
      symbol: 'SPX',
      source: 'stooq',
      tf: '1d',
      from: q.from,
      to: q.to,
      limit: q.limit ? Number(q.limit) : undefined,
      cohort: q.cohort as SpxCohort | undefined,
    });

    return { 
      ok: true, 
      symbol: 'SPX', 
      source: 'stooq', 
      tf: '1d', 
      count: rows.length, 
      candles: rows.map(r => ({
        ts: r.ts,
        date: r.date,
        o: r.open,
        h: r.high,
        l: r.low,
        c: r.close,
        v: r.volume,
        cohort: r.cohort,
      })),
    };
  });

  // ═══════════════════════════════════════════════════════════════
  // ADMIN API — SPX Data Management
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /api/fractal/v2.1/admin/spx/ingest
   * Ingest SPX candles from Stooq (idempotent)
   */
  fastify.post('/api/fractal/v2.1/admin/spx/ingest', async () => {
    try {
      const result = await ingestSpxFromStooq();
      return { ok: true, ...result };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/spx/backfill
   * Backfill SPX data for date range
   */
  fastify.post('/api/fractal/v2.1/admin/spx/backfill', async (req) => {
    const body = (req.body ?? {}) as any;
    const from = body.from as string;
    const to = body.to as string;
    const batchSize = body.batchSize as number | undefined;
    const jobId = body.jobId as string | undefined;

    if (!from || !to) {
      return { ok: false, error: 'from/to required (YYYY-MM-DD)' };
    }

    try {
      const result = await runSpxBackfill({ from, to, batchSize, jobId });
      return result;
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/backfill/status
   * Get backfill progress
   */
  fastify.get('/api/fractal/v2.1/admin/spx/backfill/status', async (req) => {
    const { jobId } = req.query as any;
    const progress = await getBackfillProgress(jobId || 'spx_full_backfill');
    return { ok: true, progress };
  });

  /**
   * POST /api/fractal/v2.1/admin/spx/backfill/reset
   * Reset backfill progress
   */
  fastify.post('/api/fractal/v2.1/admin/spx/backfill/reset', async (req) => {
    const { jobId } = (req.body ?? {}) as any;
    const result = await resetBackfillProgress(jobId || 'spx_full_backfill');
    return result;
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/validate
   * Validate SPX data integrity
   */
  fastify.get('/api/fractal/v2.1/admin/spx/validate', async (req) => {
    const { cohort } = req.query as any;
    return await validateSpxData({ cohort: cohort as SpxCohort | undefined });
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/gaps
   * Audit gaps in SPX data
   */
  fastify.get('/api/fractal/v2.1/admin/spx/gaps', async (req) => {
    const { cohort } = req.query as any;
    return await auditSpxGaps({ cohort: cohort as SpxCohort | undefined });
  });

  /**
   * POST /api/fractal/v2.1/admin/spx/indexes
   * Ensure MongoDB indexes
   */
  fastify.post('/api/fractal/v2.1/admin/spx/indexes', async () => {
    try {
      const result = await ensureSpxIndexes();
      return result;
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/cohorts
   * Get cohort counts
   */
  fastify.get('/api/fractal/v2.1/admin/spx/cohorts', async () => {
    const counts = await getCohortCounts();
    return { ok: true, cohorts: counts };
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/logs
   * Get recent ingestion logs
   */
  fastify.get('/api/fractal/v2.1/admin/spx/logs', async (req) => {
    const { limit } = req.query as any;
    const logs = await getIngestionLogs(limit ? Number(limit) : 10);
    return { ok: true, logs };
  });

  /**
   * GET /api/fractal/v2.1/admin/spx/stats
   * Get SPX stats (alias)
   */
  fastify.get('/api/fractal/v2.1/admin/spx/stats', async () => {
    return await getSpxStats();
  });

  /**
   * POST /api/fractal/v2.1/admin/spx/generate-mock
   * Generate mock SPX data (for development when APIs are rate-limited)
   * 
   * WARNING: Generates synthetic data based on historical patterns.
   * Use only for development/testing.
   */
  fastify.post('/api/fractal/v2.1/admin/spx/generate-mock', async (req) => {
    const body = (req.body ?? {}) as any;
    const from = body.from as string || '1950-01-03';
    const to = body.to as string || '2025-12-31';
    const replace = body.replace as boolean || false;

    try {
      // Optionally clear existing data
      if (replace) {
        await SpxCandleModel.deleteMany({});
      }

      // Generate mock candles
      const candles = generateMockSpxCandles(from, to);

      if (candles.length === 0) {
        return { ok: false, error: 'No candles generated' };
      }

      // Bulk upsert
      const ops = candles.map((c) => ({
        updateOne: {
          filter: { ts: c.ts },
          update: { $setOnInsert: c },
          upsert: true,
        },
      }));

      const bulk = await SpxCandleModel.bulkWrite(ops, { ordered: false });
      const written = bulk.upsertedCount ?? 0;
      const skipped = candles.length - written;

      // Cohort summary
      const cohortCounts: Record<string, number> = {};
      for (const c of candles) {
        cohortCounts[c.cohort] = (cohortCounts[c.cohort] || 0) + 1;
      }

      return {
        ok: true,
        source: 'MOCK_GENERATOR',
        range: { from, to },
        generated: candles.length,
        written,
        skipped,
        cohorts: cohortCounts,
        warning: 'This is synthetic data based on historical patterns. Use for development only.',
      };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  /**
   * POST /api/fractal/v2.1/admin/spx/ingest-csv
   * Ingest SPX data from Yahoo Finance CSV file
   */
  fastify.post('/api/fractal/v2.1/admin/spx/ingest-csv', async (req) => {
    const body = (req.body ?? {}) as any;
    const csvPath = body.csvPath as string || '/app/data/spx_1950_2025.csv';
    const replace = body.replace as boolean || false;

    try {
      if (replace) {
        return await replaceWithYahooCsv(csvPath);
      } else {
        return await ingestFromYahooCsv(csvPath);
      }
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  fastify.log.info(`[SPX] Terminal routes registered at ${prefix}/* (DATA FOUNDATION READY)`);
  fastify.log.info(`[SPX] Admin routes registered at /api/fractal/v2.1/admin/spx/*`);
}

export default registerSpxRoutes;
