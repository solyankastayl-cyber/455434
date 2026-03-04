/**
 * SPX CALIBRATION — Routes
 * 
 * BLOCK B6.4 — Historical Calibration API
 * 
 * Endpoints:
 * - GET  /api/spx/v2.1/admin/calibration/expected
 * - GET  /api/spx/v2.1/admin/calibration/status
 * - POST /api/spx/v2.1/admin/calibration/run
 * - POST /api/spx/v2.1/admin/calibration/stop
 * - POST /api/spx/v2.1/admin/calibration/reset
 * - GET  /api/spx/v2.1/admin/calibration/logs
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxExpectedService } from './spx-expected.service.js';
import { spxCalibrationRunner } from './spx-calibration.runner.js';
import { DEFAULT_PRESETS, DEFAULT_ROLES } from './spx-calibration.types.js';

interface CalibrationRunBody {
  start?: string;
  end?: string;
  presets?: string[];
  roles?: string[];
  chunkSize?: number;
  source?: string;
}

export async function registerSpxCalibrationRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1/admin/calibration';

  /**
   * GET /api/spx/v2.1/admin/calibration/expected
   * 
   * Calculate expected snapshots/outcomes before running calibration
   */
  app.get(`${prefix}/expected`, async (
    request: FastifyRequest<{ 
      Querystring: { 
        start?: string; 
        end?: string; 
        presets?: string; 
        roles?: string; 
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { 
        start = '1950-01-03', 
        end = '2026-02-20',
        presets = 'BALANCED',
        roles = 'USER'
      } = request.query;

      const result = await spxExpectedService.getExpected({
        start,
        end,
        presets: presets.split(','),
        roles: roles.split(','),
      });

      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/calibration/status
   */
  app.get(`${prefix}/status`, async (request, reply) => {
    try {
      const status = await spxCalibrationRunner.getStatus();
      return reply.send({ ok: true, status: status || { state: 'NOT_INITIALIZED' } });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/calibration/logs
   */
  app.get(`${prefix}/logs`, async (
    request: FastifyRequest<{ Querystring: { limit?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const limit = Math.min(Number(request.query.limit || 50), 500);
      const logs = await spxCalibrationRunner.getLogs(limit);
      return reply.send({ ok: true, logs });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/calibration/run
   * 
   * Start or continue calibration run
   */
  app.post(`${prefix}/run`, async (
    request: FastifyRequest<{ Body: CalibrationRunBody }>,
    reply: FastifyReply
  ) => {
    try {
      const body = request.body || {};
      const {
        start = '1950-01-03',
        end = '2026-02-20',
        presets = DEFAULT_PRESETS,
        roles = DEFAULT_ROLES,
        chunkSize = 50,
        source = 'BOOTSTRAP',
      } = body;

      // Initialize or load existing run
      await spxCalibrationRunner.initOrLoad({
        start,
        end,
        presets,
        roles,
        chunkSize,
        source,
      });

      // Run one chunk
      const status = await spxCalibrationRunner.runOnce();

      return reply.send({ ok: true, status });
    } catch (err: any) {
      console.error('[SPX Calibration] Run error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/calibration/stop
   */
  app.post(`${prefix}/stop`, async (request, reply) => {
    try {
      await spxCalibrationRunner.requestStop();
      return reply.send({ ok: true, message: 'Stop requested' });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/calibration/reset
   * 
   * Reset calibration (delete run state)
   */
  app.post(`${prefix}/reset`, async (request, reply) => {
    try {
      await spxCalibrationRunner.reset();
      return reply.send({ ok: true, message: 'Calibration reset' });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/calibration/recompute-outcomes
   * 
   * B6.4.5 — Recompute hit for existing outcomes without recreating snapshots
   * Use after fixing hit logic to update existing outcomes
   */
  app.post(`${prefix}/recompute-outcomes`, async (
    request: FastifyRequest<{ Body: { batchSize?: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { batchSize = 1000 } = request.body || {};
      const result = await spxCalibrationRunner.recomputeOutcomes(batchSize);
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      console.error('[SPX Calibration] Recompute error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/calibration/coverage
   * 
   * B6.4.6 — Detailed coverage report by decade/horizon/cohort
   */
  app.get(`${prefix}/coverage`, async (request, reply) => {
    try {
      const result = await spxCalibrationRunner.getCoverageReport();
      return reply.send({ ok: true, ...result });
    } catch (err: any) {
      console.error('[SPX Calibration] Coverage error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/spx/v2.1/admin/calibration/run-continuous
   * 
   * B6.4.6 — Run calibration continuously until completion or stop
   */
  app.post(`${prefix}/run-continuous`, async (
    request: FastifyRequest<{ Body: { maxChunks?: number; chunkSize?: number } }>,
    reply: FastifyReply
  ) => {
    try {
      const { maxChunks = 100, chunkSize = 500 } = request.body || {};
      
      // Start continuous run in background
      spxCalibrationRunner.runContinuous(maxChunks, chunkSize).catch(err => {
        console.error('[SPX Calibration] Continuous run error:', err);
      });
      
      return reply.send({ 
        ok: true, 
        message: `Started continuous calibration (max ${maxChunks} chunks of ${chunkSize})` 
      });
    } catch (err: any) {
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/spx/v2.1/admin/calibration/decade-tracker
   * 
   * B6.10.2 — Live decade aggregator with skill tracking
   * Shows how model evolves across decades (1950s, 1960s, ... 2020s)
   */
  app.get(`${prefix}/decade-tracker`, async (
    request: FastifyRequest<{ Querystring: { preset?: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const { spxDecadeTrackerService } = await import('./spx-decade-tracker.service.js');
      const preset = request.query.preset ?? 'BALANCED';
      const result = await spxDecadeTrackerService.buildDecadeTracker(preset);
      
      return reply.send({
        ok: true,
        data: result,
        meta: {
          totalSamples: result.global.totalSamples,
          decadeCount: result.decades.length,
          modelState: result.global.modelState,
        },
      });
    } catch (err: any) {
      console.error('[SPX Calibration] Decade tracker error:', err);
      return reply.status(500).send({ ok: false, error: err.message });
    }
  });

  console.log('[SPX Calibration] Routes registered at', prefix);
}

export default registerSpxCalibrationRoutes;
