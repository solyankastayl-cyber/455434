/**
 * SPX DRIFT — Routes
 * 
 * BLOCK B6.3 — API endpoints for drift intelligence
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { SpxDriftService } from './spx-drift.service.js';
import type { DriftWindow, SpxCohort } from './spx-drift.types.js';

const WINDOWS: DriftWindow[] = ['30d', '60d', '90d', '180d', '365d', 'all'];
const COMPARES: SpxCohort[] = ['V2020', 'V1950', 'ALL_VINTAGE'];

function isWindow(x: any): x is DriftWindow {
  return WINDOWS.includes(x);
}

function isCompare(x: any): x is Exclude<SpxCohort, 'LIVE'> {
  return x === 'V2020' || x === 'V1950' || x === 'ALL_VINTAGE';
}

export async function registerSpxDriftRoutes(fastify: FastifyInstance) {
  const service = new SpxDriftService();
  
  const prefix = '/api/spx/v2.1/admin/drift';

  /**
   * GET /api/spx/v2.1/admin/drift
   * 
   * On-demand drift report
   */
  fastify.get(prefix, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { window?: string; compare?: string; asOfDate?: string };
    
    const window = query.window || '90d';
    const compare = query.compare || 'V2020';
    const asOfDate = query.asOfDate;

    if (!isWindow(window)) {
      return reply.code(400).send({ ok: false, error: 'Invalid window' });
    }
    if (!isCompare(compare)) {
      return reply.code(400).send({ ok: false, error: 'Invalid compare' });
    }

    try {
      const report = await service.buildReport({ window, compare, asOfDate });
      return reply.send({ ok: true, ...report });
    } catch (error: any) {
      fastify.log.error(`[SPX Drift] Error: ${error.message}`);
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/drift/write
   * 
   * Write daily drift history (for daily-run pipeline)
   */
  fastify.post(`${prefix}/write`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body || {}) as { window?: string; compare?: string; date?: string };
    
    const window = body.window || '90d';
    const compare = body.compare || 'V2020';
    const date = body.date;

    if (!isWindow(window)) {
      return reply.code(400).send({ ok: false, error: 'Invalid window' });
    }
    if (!isCompare(compare)) {
      return reply.code(400).send({ ok: false, error: 'Invalid compare' });
    }

    try {
      const report = await service.writeDailyHistory({ window, compare, date });
      return reply.send({ ok: true, report });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/drift/history
   * 
   * Get drift history for charts
   */
  fastify.get(`${prefix}/history`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { window?: string; compare?: string; limit?: string };
    
    const window = query.window || '90d';
    const compare = query.compare || 'V2020';
    const limit = query.limit ? Number(query.limit) : 60;

    if (!isWindow(window)) {
      return reply.code(400).send({ ok: false, error: 'Invalid window' });
    }
    if (!isCompare(compare)) {
      return reply.code(400).send({ ok: false, error: 'Invalid compare' });
    }

    try {
      const rows = await service.getHistory({ window, compare, limit });
      return reply.send({ ok: true, rows });
    } catch (error: any) {
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/drift/intelligence
   * 
   * Full intelligence report (all cohorts comparison)
   */
  fastify.get(`${prefix}/intelligence`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { window?: string; preset?: string; write?: string };
    
    const window = query.window || '90d';
    const preset = query.preset || 'BALANCED';
    const writeHistory = query.write === '1';

    if (!isWindow(window)) {
      return reply.code(400).send({ ok: false, error: 'Invalid window' });
    }

    try {
      // Build reports for all vintage cohorts
      const cohorts: SpxCohort[] = ['V1950', 'V2020', 'ALL_VINTAGE'];
      const comparisons = await Promise.all(
        cohorts.map(async (compare) => {
          const report = await service.buildReport({ window, compare: compare as any });
          return {
            cohort: compare,
            ...report,
          };
        })
      );

      // Get LIVE metrics for summary
      const liveMetrics = comparisons[0]?.live || { 
        samples: 0, hitRate: 0, expectancy: 0, sharpe: 0, maxDD: 0 
      };

      // Overall severity = worst
      const severityRank: Record<string, number> = { OK: 0, WATCH: 1, WARN: 2, CRITICAL: 3 };
      const overallSeverity = comparisons.reduce(
        (worst, c) => (severityRank[c.severity] > severityRank[worst] ? c.severity : worst),
        'OK'
      );

      // Build delta matrix for UI
      const matrix = {
        hitRate: Object.fromEntries(comparisons.map(c => [c.cohort, c.delta.hitRate])),
        expectancy: Object.fromEntries(comparisons.map(c => [c.cohort, c.delta.expectancy])),
        sharpe: Object.fromEntries(comparisons.map(c => [c.cohort, c.delta.sharpe])),
        maxDD: Object.fromEntries(comparisons.map(c => [c.cohort, c.delta.maxDD])),
      };

      const result = {
        ok: true,
        meta: {
          symbol: 'SPX',
          preset,
          window,
          asOf: new Date().toISOString(),
          liveSamples: liveMetrics.samples,
          confidence: comparisons[0]?.confidence || 'LOW',
          severity: overallSeverity,
        },
        live: liveMetrics,
        comparisons: comparisons.map(c => ({
          cohort: c.cohort,
          severity: c.severity,
          confidence: c.confidence,
          delta: c.delta,
          vintage: c.vintage,
          notes: c.notes,
        })),
        matrix,
      };

      // Optionally write all to history
      if (writeHistory) {
        await Promise.all(
          cohorts.map(compare => service.writeDailyHistory({ window, compare: compare as any }))
        );
      }

      return reply.send(result);
    } catch (error: any) {
      fastify.log.error(`[SPX Drift] Intelligence error: ${error.message}`);
      return reply.code(500).send({ ok: false, error: error.message });
    }
  });

  fastify.log.info(`[SPX Drift] Routes registered at ${prefix}/* (BLOCK B6.3 READY)`);
}

export default registerSpxDriftRoutes;
