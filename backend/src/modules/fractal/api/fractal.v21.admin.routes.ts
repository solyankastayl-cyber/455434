/**
 * BLOCK 43.4 — Fractal V2.1 Admin Routes
 * Single Status Endpoint + Drift Injection API
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';
import {
  FractalCalibrationV2Model,
  FractalReliabilitySnapshotModel,
  FractalCertStampModel,
  FractalEntropyHistoryModel,
  driftInjectService,
  reliabilitySnapshotWriter,
  type ReliabilityBadge,
} from '../storage/index.js';

// Singleton instances
const engine = new FractalEngine();
const canonicalStore = new CanonicalStore();

/**
 * Calculate reliability from calibration state
 */
function calculateReliability(calibration: any): { 
  score: number; 
  badge: ReliabilityBadge;
  components: { drift: number; calibration: number; rolling: number; mcTail: number };
} {
  if (!calibration) {
    return {
      score: 0.5,
      badge: 'WARN',
      components: { drift: 0.5, calibration: 0.5, rolling: 0.5, mcTail: 0.5 },
    };
  }

  const eceScore = Math.max(0, 1 - calibration.ece * 5);
  const brierScore = Math.max(0, 1 - calibration.brier * 2);
  const calibrationScore = (eceScore * 0.6 + brierScore * 0.4);

  let badge: ReliabilityBadge = 'OK';
  if (calibration.ece > 0.15 || calibration.brier > 0.30) badge = 'CRITICAL';
  else if (calibration.ece > 0.10 || calibration.brier > 0.25) badge = 'DEGRADED';
  else if (calibration.ece > 0.05 || calibration.brier > 0.15) badge = 'WARN';

  return {
    score: calibrationScore,
    badge,
    components: {
      drift: 0.8,  // Would come from drift detection
      calibration: calibrationScore,
      rolling: 0.85,  // Would come from rolling validation
      mcTail: 0.75,   // Would come from Monte Carlo
    },
  };
}

export async function fractalV21AdminRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * BLOCK 43.4 — Single Status Endpoint
   * GET /api/fractal/v2.1/admin/status
   * 
   * Returns complete system state for UI dashboard
   */
  fastify.get('/api/fractal/v2.1/admin/status', async (
    request: FastifyRequest<{ Querystring: { modelKey?: string; presetKey?: string } }>
  ) => {
    const modelKey = request.query.modelKey ?? 'BTCUSD:14';
    const presetKey = request.query.presetKey ?? 'v2_entropy_final';
    const [symbol, horizonStr] = modelKey.split(':');
    const horizonDays = parseInt(horizonStr) || 14;

    try {
      // 1. Get current signal using engine.match()
      let signal: any = { action: 'NEUTRAL', confidence: 0, matches: 0 };
      try {
        const matchResult = await engine.match({
          symbol: symbol === 'BTCUSD' ? 'BTC' : symbol,
          timeframe: '1d',
          windowLen: 30,
          topK: 25,
          horizonDays: horizonDays,
        });
        signal = {
          action: matchResult.forwardStats?.posRate > 0.6 ? 'BUY' : 
                  matchResult.forwardStats?.posRate < 0.4 ? 'SELL' : 'NEUTRAL',
          confidence: matchResult.confidence || 0,
          matches: matchResult.matches?.length || 0,
        };
      } catch (matchErr) {
        console.warn('[Status] Match error:', matchErr);
      }

      // 2. Get calibration state
      const calibration = await FractalCalibrationV2Model
        .findOne({ modelKey, presetKey, horizonDays })
        .lean();

      // 3. Calculate reliability
      const reliability = calculateReliability(calibration);

      // 4. Get latest cert stamp
      const lastCert = await FractalCertStampModel
        .findOne({ modelKey, presetKey })
        .sort({ ts: -1 })
        .lean();

      // 5. Get latest reliability snapshot
      const lastSnapshot = await FractalReliabilitySnapshotModel
        .findOne({ modelKey, presetKey })
        .sort({ ts: -1 })
        .lean();

      // 6. Get latest entropy
      const lastEntropy = await FractalEntropyHistoryModel
        .findOne({ modelKey, presetKey })
        .sort({ ts: -1 })
        .lean();

      // 7. Determine no-trade reasons
      const noTradeReasons: string[] = [];
      if (reliability.badge === 'CRITICAL') noTradeReasons.push('RELIABILITY_CRITICAL');
      if (reliability.badge === 'DEGRADED') noTradeReasons.push('RELIABILITY_DEGRADED');
      if (signal.confidence < 0.1) noTradeReasons.push('LOW_CONFIDENCE');
      if (lastEntropy && lastEntropy.entropy > 0.85) noTradeReasons.push('HIGH_ENTROPY');

      return {
        ts: Date.now(),
        modelKey,
        presetKey,
        
        signal: {
          action: signal.action,
          confidence: signal.confidence,
          matches: signal.matches ?? 0,
        },
        
        reliability: {
          score: reliability.score,
          badge: reliability.badge,
          components: reliability.components,
        },
        
        calibration: calibration ? {
          ece: calibration.ece,
          brier: calibration.brier,
          bucketsCount: calibration.buckets?.length ?? 0,
          updatedAtTs: calibration.updatedAtTs,
        } : null,
        
        entropy: lastEntropy ? {
          value: lastEntropy.entropy,
          ema: lastEntropy.emaEntropy,
          sizeMultiplier: lastEntropy.sizeMultiplier,
          dominance: lastEntropy.dominance,
        } : null,
        
        lastCert: lastCert ? {
          ts: lastCert.ts,
          verdict: lastCert.verdict,
          frozen: lastCert.frozen,
          version: lastCert.version,
        } : null,
        
        lastSnapshot: lastSnapshot ? {
          ts: lastSnapshot.ts,
          badge: lastSnapshot.badge,
          score: lastSnapshot.reliabilityScore,
        } : null,
        
        noTradeReasons,
        
        dataHealth: {
          matchCount: signal.matches,
          bootstrapped: true,
        },
      };
    } catch (err) {
      console.error('[Status] Error:', err);
      return {
        ts: Date.now(),
        modelKey,
        presetKey,
        error: String(err),
      };
    }
  });

  /**
   * BLOCK 43.3 — Drift Injection Endpoint (Real)
   * POST /api/fractal/v2.1/admin/drift/inject
   */
  fastify.post('/api/fractal/v2.1/admin/drift/inject', async (
    request: FastifyRequest<{ 
      Body: { 
        modelKey?: string; 
        presetKey?: string; 
        horizonDays?: number;
        severity?: number;
      } 
    }>
  ) => {
    const { modelKey = 'BTCUSD:14', presetKey = 'v2_entropy_final', horizonDays = 14, severity = 0.25 } = request.body;

    const result = await driftInjectService.inject({
      modelKey,
      presetKey,
      horizonDays,
      severity,
    });

    return {
      ok: result.ok,
      ...result,
    };
  });

  /**
   * Reset calibration to clean state
   * POST /api/fractal/v2.1/admin/drift/reset
   */
  fastify.post('/api/fractal/v2.1/admin/drift/reset', async (
    request: FastifyRequest<{ 
      Body: { modelKey?: string; presetKey?: string; horizonDays?: number } 
    }>
  ) => {
    const { modelKey = 'BTCUSD:14', presetKey = 'v2_entropy_final', horizonDays = 14 } = request.body;

    const result = await driftInjectService.reset(modelKey, presetKey, horizonDays);
    return result;
  });

  /**
   * Get reliability history
   * GET /api/fractal/v2.1/admin/reliability/history
   */
  fastify.get('/api/fractal/v2.1/admin/reliability/history', async (
    request: FastifyRequest<{ 
      Querystring: { modelKey?: string; presetKey?: string; limit?: string } 
    }>
  ) => {
    const modelKey = request.query.modelKey ?? 'BTCUSD:14';
    const presetKey = request.query.presetKey ?? 'v2_entropy_final';
    const limit = parseInt(request.query.limit ?? '50');

    const history = await reliabilitySnapshotWriter.getHistory(modelKey, presetKey, limit);

    return {
      modelKey,
      presetKey,
      count: history.length,
      history,
    };
  });

  console.log('[Fractal] V2.1 Admin routes registered (BLOCK 43.4: Status + Drift + History)');
}
