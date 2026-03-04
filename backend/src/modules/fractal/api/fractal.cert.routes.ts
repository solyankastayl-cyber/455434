/**
 * BLOCK 41.x — Fractal Certification Routes
 * Final Certification Suite API Endpoints
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import {
  runReplay,
  runCertificationSuite,
  runDriftInjection,
  runPhaseReplay,
  freezeCertification,
  type ReplayRequest,
  type CertificationRequest,
  type DriftInjectRequest,
  type PhaseReplayRequest,
  type FreezeRequest,
} from '../cert/index.js';

// Minimal Fractal Service adapter for certification
function getFractalService(fastify: FastifyInstance) {
  return {
    getSignal: async (params: any) => {
      // Use existing engine to get signal
      const { FractalEngine } = await import('../engine/fractal.engine.js');
      const engine = new FractalEngine();
      
      // Get candles from canonical store
      const { CanonicalStore } = await import('../data/canonical.store.js');
      const store = new CanonicalStore();
      
      const asOf = params.asOf ? new Date(params.asOf) : new Date();
      const candles = await store.getRange(
        params.symbol || 'BTCUSD',
        params.timeframe || '1d',
        new Date('2010-01-01'),
        asOf
      );

      if (candles.length < 30) {
        return { signal: 'NEUTRAL', confidence: 0, error: 'Insufficient data' };
      }

      // Run pattern matching
      const matches = engine.findMatches(candles, { windowLen: 30, topK: 25 });
      const signal = engine.computeSignal(candles, matches);

      return {
        signal: signal.action,
        confidence: signal.confidence,
        exposure: signal.exposure ?? 1,
        reliabilityBadge: 'OK',
        matches: matches.slice(0, 5),
      };
    },

    getPreset: async (key: string) => {
      const { FRACTAL_PRESETS } = await import('../config/fractal.presets.js');
      return FRACTAL_PRESETS[key] ?? null;
    },

    lockPreset: async (key: string, stamp: any) => {
      // In production, save to MongoDB
      console.log(`[Cert] Locking preset ${key}:`, stamp);
      return { ok: true };
    },

    runBacktest: async (params: any) => {
      // Use backtest service if available
      try {
        const { FractalBacktestService } = await import('../backtest/fractal.backtest.service.js');
        const service = new FractalBacktestService();
        return await service.run(params);
      } catch {
        return null; // Backtest not available
      }
    },
  };
}

export async function fractalCertRoutes(fastify: FastifyInstance): Promise<void> {
  const fractalSvc = getFractalService(fastify);

  /**
   * BLOCK 41.1 — Deterministic Replay Test
   * POST /api/fractal/v2.1/admin/cert/replay
   */
  fastify.post('/api/fractal/v2.1/admin/cert/replay', async (
    request: FastifyRequest<{ Body: ReplayRequest }>
  ) => {
    const body = request.body;
    const result = await runReplay(fractalSvc, {
      asOf: body.asOf,
      presetKey: body.presetKey,
      runs: body.runs ?? 100,
      symbol: body.symbol ?? 'BTCUSD',
      timeframe: body.timeframe ?? '1d',
    });
    return result;
  });

  /**
   * BLOCK 41.2 — Full Certification Suite
   * POST /api/fractal/v2.1/admin/cert/run
   */
  fastify.post('/api/fractal/v2.1/admin/cert/run', async (
    request: FastifyRequest<{ Body: CertificationRequest }>
  ) => {
    const body = request.body;
    const result = await runCertificationSuite(fractalSvc, {
      asOf: body.asOf,
      presetKey: body.presetKey,
      symbol: body.symbol ?? 'BTCUSD',
      timeframe: body.timeframe ?? '1d',
    });
    return result;
  });

  /**
   * BLOCK 41.3 — Drift Injection Test
   * POST /api/fractal/v2.1/admin/cert/drift-inject
   */
  fastify.post('/api/fractal/v2.1/admin/cert/drift-inject', async (
    request: FastifyRequest<{ Body: DriftInjectRequest }>
  ) => {
    const body = request.body;
    const result = await runDriftInjection(fractalSvc, {
      asOf: body.asOf,
      presetKey: body.presetKey,
      inject: body.inject,
    });
    return result;
  });

  /**
   * BLOCK 41.4 — Phase Stress Replay
   * POST /api/fractal/v2.1/admin/cert/phase-replay
   */
  fastify.post('/api/fractal/v2.1/admin/cert/phase-replay', async (
    request: FastifyRequest<{ Body: PhaseReplayRequest }>
  ) => {
    const body = request.body;
    const result = await runPhaseReplay(fractalSvc, {
      presetKey: body.presetKey,
      symbol: body.symbol ?? 'BTCUSD',
      timeframe: body.timeframe ?? '1d',
    });
    return result;
  });

  /**
   * BLOCK 41.5 — Freeze Certification
   * POST /api/fractal/v2.1/admin/cert/freeze
   */
  fastify.post('/api/fractal/v2.1/admin/cert/freeze', async (
    request: FastifyRequest<{ Body: FreezeRequest }>
  ) => {
    const body = request.body;
    const result = await freezeCertification(fractalSvc, {
      presetKey: body.presetKey,
      certificationReport: body.certificationReport,
    });
    return result;
  });

  console.log('[Fractal] Certification routes registered (BLOCK 41.1-41.5)');
}
