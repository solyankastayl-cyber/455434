/**
 * Stress Simulation + Platform Crash-Test Routes
 * 
 * POST /api/brain/v2/stress/run          — Run stress scenario (sync)
 * POST /api/brain/v2/stress/run-async    — Run stress scenario (async)
 * GET  /api/brain/v2/stress/presets      — List available presets
 * GET  /api/brain/v2/stress/status       — Get latest stress result
 * POST /api/platform/crash-test/run      — Run full crash-test (sync)
 * POST /api/platform/crash-test/run-async — Run full crash-test (async)
 * GET  /api/platform/crash-test/status   — Get latest crash-test result
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStressSimulationService } from '../services/stress_simulation.service.js';
import { getCrashTestService } from '../services/crash_test.service.js';
import { BLACK_SWAN_LIBRARY, getPresetNames } from '../stress/black_swan_library.js';
import type { StressSimReport, CrashTestReport } from '../contracts/stress_sim.contract.js';

// In-memory storage for async results
let latestStressResult: { status: 'running' | 'complete' | 'error'; report?: StressSimReport; error?: string; startedAt?: string } = { status: 'complete' };
let latestCrashTestResult: { status: 'running' | 'complete' | 'error'; report?: CrashTestReport; error?: string; startedAt?: string } = { status: 'complete' };

export async function stressCrashTestRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/stress/run — Run stress scenario (sync)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/stress/run', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        stepDays?: number;
        scenarioPreset?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asset = body.asset || 'dxy';
    const start = body.start || '2020-01-01';
    const end = body.end || '2020-06-01';
    const stepDays = body.stepDays || 7;
    const scenarioPreset = body.scenarioPreset || 'COVID_CRASH';

    try {
      const service = getStressSimulationService();
      const report = await service.runStress({
        asset, start, end, stepDays, scenarioPreset,
      });

      latestStressResult = { status: 'complete', report };
      return reply.send({ ok: true, ...report });
    } catch (e) {
      latestStressResult = { status: 'error', error: (e as Error).message };
      return reply.status(500).send({
        ok: false,
        error: 'STRESS_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/stress/run-async — Run stress scenario (async)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/stress/run-async', async (
    request: FastifyRequest<{
      Body: {
        asset?: string;
        start?: string;
        end?: string;
        stepDays?: number;
        scenarioPreset?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asset = body.asset || 'dxy';
    const start = body.start || '2020-01-01';
    const end = body.end || '2020-06-01';
    const stepDays = body.stepDays || 7;
    const scenarioPreset = body.scenarioPreset || 'COVID_CRASH';

    latestStressResult = { status: 'running', startedAt: new Date().toISOString() };
    
    // Run async (don't await)
    (async () => {
      try {
        const service = getStressSimulationService();
        const report = await service.runStress({ asset, start, end, stepDays, scenarioPreset });
        latestStressResult = { status: 'complete', report };
        console.log(`[Stress] Async complete: resilient=${report.verdict.resilient}`);
      } catch (e) {
        latestStressResult = { status: 'error', error: (e as Error).message };
        console.error(`[Stress] Async error:`, e);
      }
    })();

    return reply.send({ 
      ok: true, 
      status: 'started',
      message: 'Stress simulation started. Poll /api/brain/v2/stress/status for results.',
      params: { asset, start, end, stepDays, scenarioPreset }
    });
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/stress/status — Get latest stress result
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/stress/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({ ok: true, ...latestStressResult });
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/stress/presets — List presets
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/stress/presets', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const presets = Object.entries(BLACK_SWAN_LIBRARY).map(([key, val]) => ({
      name: key,
      description: val.description,
      overrides: val.overrides,
    }));

    return reply.send({ ok: true, presets });
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/platform/crash-test/run — Full crash-test (sync)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/platform/crash-test/run', async (
    request: FastifyRequest<{
      Body: {
        start?: string;
        end?: string;
        stepDays?: number;
        asset?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const start = body.start || '2024-01-01';
    const end = body.end || '2025-12-01';
    const stepDays = body.stepDays || 30;
    const asset = body.asset || 'dxy';

    try {
      console.log(`[CrashTest] Starting platform crash-test: ${start}→${end}, step=${stepDays}d`);
      const service = getCrashTestService();
      const report = await service.runCrashTest({ start, end, stepDays, asset });

      console.log(`[CrashTest] Complete: resilience=${report.resilienceScore}, grade=${report.verdict.grade}`);
      latestCrashTestResult = { status: 'complete', report };

      return reply.send({ ok: true, ...report });
    } catch (e) {
      console.error('[CrashTest] Error:', e);
      latestCrashTestResult = { status: 'error', error: (e as Error).message };
      return reply.status(500).send({
        ok: false,
        error: 'CRASH_TEST_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/platform/crash-test/run-async — Full crash-test (async)
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/platform/crash-test/run-async', async (
    request: FastifyRequest<{
      Body: {
        start?: string;
        end?: string;
        stepDays?: number;
        asset?: string;
      }
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const start = body.start || '2025-01-01';
    const end = body.end || '2025-06-01';
    const stepDays = body.stepDays || 30;
    const asset = body.asset || 'dxy';

    latestCrashTestResult = { status: 'running', startedAt: new Date().toISOString() };
    
    // Run async (don't await)
    (async () => {
      try {
        console.log(`[CrashTest] Async starting: ${start}→${end}, step=${stepDays}d`);
        const service = getCrashTestService();
        const report = await service.runCrashTest({ start, end, stepDays, asset });
        latestCrashTestResult = { status: 'complete', report };
        console.log(`[CrashTest] Async complete: resilience=${report.resilienceScore}, grade=${report.verdict.grade}`);
      } catch (e) {
        latestCrashTestResult = { status: 'error', error: (e as Error).message };
        console.error(`[CrashTest] Async error:`, e);
      }
    })();

    return reply.send({ 
      ok: true, 
      status: 'started',
      message: 'Crash-test started. Poll /api/platform/crash-test/status for results.',
      params: { asset, start, end, stepDays }
    });
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/platform/crash-test/status — Get latest crash-test result
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/platform/crash-test/status', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({ ok: true, ...latestCrashTestResult });
  });

  console.log('[Stress+CrashTest] Routes registered at /api/brain/v2/stress, /api/platform/crash-test');
}
