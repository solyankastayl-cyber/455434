/**
 * SPX CONSENSUS ROUTES — HTTP Endpoints
 * 
 * BLOCK B5.5 — SPX Consensus Engine API
 * 
 * Updated: Real horizonStack from focus-pack computations
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { spxConsensusService } from './spx-consensus.service.js';
import { spxPhaseService } from '../spx-phase/spx-phase.service.js';
import { SpxCandleModel } from '../spx/spx.mongo.js';
import { buildRealHorizonStack } from './spx-horizon-stack.builder.js';
import { FEATURE_FLAGS } from '../../config/feature-flags.js';
import type { SpxHorizon } from './spx-consensus.types.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface ConsensusQuerystring {
  preset?: 'BALANCED' | 'CONSERVATIVE' | 'AGGRESSIVE';
  useRealStack?: string; // 'true' | 'false'
}

interface HorizonStackItem {
  horizon: SpxHorizon;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  confidence: number;
  divergenceGrade: string;
  blockers?: string[];
}

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxConsensusRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/spx/v2.1';

  /**
   * GET /api/spx/v2.1/consensus
   * 
   * Build consensus from all horizons
   * 
   * Query params:
   * - preset: BALANCED | CONSERVATIVE | AGGRESSIVE
   * - useRealStack: true | false (defaults to FEATURE_FLAGS.SPX_REAL_HORIZON_STACK)
   */
  app.get(`${prefix}/consensus`, async (
    request: FastifyRequest<{ Querystring: ConsensusQuerystring }>,
    reply: FastifyReply
  ) => {
    try {
      const { preset = 'BALANCED', useRealStack } = request.query;
      
      // Determine if using real horizon stack
      const shouldUseRealStack = useRealStack === 'true' || 
        (useRealStack !== 'false' && FEATURE_FLAGS.SPX_REAL_HORIZON_STACK);

      // Load candles for phase detection
      const candles = await SpxCandleModel.find()
        .sort({ t: 1 })
        .lean()
        .exec();

      if (candles.length < 250) {
        return reply.send({
          ok: false,
          error: 'Insufficient SPX data for consensus computation',
          minRequired: 250,
          actual: candles.length,
        });
      }

      // Build phase context
      const phaseOutput = spxPhaseService.build(candles as any);
      const phaseNow = {
        phase: phaseOutput.phaseIdAtNow.phase,
        flags: phaseOutput.currentFlags,
      };

      let horizonStack: HorizonStackItem[];
      let horizonStackMeta: any = {};

      if (shouldUseRealStack) {
        // ═══════════════════════════════════════════════════════════════
        // REAL HORIZON STACK — Built from actual focus-pack computations
        // ═══════════════════════════════════════════════════════════════
        console.log('[SPX Consensus] Building REAL horizon stack from focus-pack...');
        const stackResult = await buildRealHorizonStack();
        
        horizonStack = stackResult.stack.map(item => ({
          horizon: item.horizon,
          direction: item.direction,
          confidence: item.confidence,
          divergenceGrade: item.divergenceGrade,
          blockers: item.blockers,
        }));
        
        horizonStackMeta = {
          source: 'REAL_FOCUS_PACK',
          buildTimeMs: stackResult.buildTimeMs,
          successCount: stackResult.successCount,
          failCount: stackResult.failCount,
          errors: stackResult.errors.length > 0 ? stackResult.errors : undefined,
          // Include detailed stack info
          details: stackResult.stack.map(item => ({
            horizon: item.horizon,
            tier: item.tier,
            direction: item.direction,
            confidence: item.confidence,
            hitRate: item.hitRate,
            medianReturn: item.medianReturn,
            sampleSize: item.sampleSize,
            divergenceGrade: item.divergenceGrade,
            blockers: item.blockers,
          })),
        };
        
        console.log(`[SPX Consensus] Real stack built: ${stackResult.successCount}/${stackResult.stack.length} horizons OK, ${stackResult.buildTimeMs}ms`);
      } else {
        // ═══════════════════════════════════════════════════════════════
        // FALLBACK MOCK — For testing or when real stack is disabled
        // ═══════════════════════════════════════════════════════════════
        console.log('[SPX Consensus] Using MOCK horizon stack (fallback)');
        horizonStack = [
          { horizon: '7d', direction: 'BULL', confidence: 0.65, divergenceGrade: 'B' },
          { horizon: '14d', direction: 'BULL', confidence: 0.58, divergenceGrade: 'C' },
          { horizon: '30d', direction: 'NEUTRAL', confidence: 0.52, divergenceGrade: 'B' },
          { horizon: '90d', direction: 'BULL', confidence: 0.61, divergenceGrade: 'A' },
          { horizon: '180d', direction: 'BULL', confidence: 0.68, divergenceGrade: 'A' },
          { horizon: '365d', direction: 'BULL', confidence: 0.72, divergenceGrade: 'B' },
        ];
        
        horizonStackMeta = {
          source: 'MOCK_FALLBACK',
          reason: 'Real stack disabled or not requested',
        };
      }

      // Build consensus
      const consensus = spxConsensusService.build({
        horizonStack,
        phaseNow,
        preset,
      });

      return reply.send({
        ok: true,
        data: consensus,
        meta: {
          horizonCount: horizonStack.length,
          phaseType: phaseNow.phase,
          preset,
          computedAt: new Date().toISOString(),
          horizonStack: horizonStackMeta,
        },
      });
    } catch (err: any) {
      console.error('[SPX Consensus] Error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Consensus computation failed',
      });
    }
  });

  /**
   * POST /api/spx/v2.1/consensus/compute
   * 
   * Compute consensus with custom horizon stack
   */
  app.post(`${prefix}/consensus/compute`, async (
    request: FastifyRequest<{ 
      Body: { 
        horizonStack: HorizonStackItem[];
        preset?: 'BALANCED' | 'CONSERVATIVE' | 'AGGRESSIVE';
      } 
    }>,
    reply: FastifyReply
  ) => {
    try {
      const { horizonStack, preset = 'BALANCED' } = request.body;

      if (!horizonStack || horizonStack.length === 0) {
        return reply.status(400).send({
          ok: false,
          error: 'horizonStack is required',
        });
      }

      // Load candles for phase detection
      const candles = await SpxCandleModel.find()
        .sort({ t: 1 })
        .lean()
        .exec();

      // Build phase context
      let phaseNow = undefined;
      if (candles.length >= 250) {
        const phaseOutput = spxPhaseService.build(candles as any);
        phaseNow = {
          phase: phaseOutput.phaseIdAtNow.phase,
          flags: phaseOutput.currentFlags,
        };
      }

      // Build consensus
      const consensus = spxConsensusService.build({
        horizonStack,
        phaseNow,
        preset,
      });

      return reply.send({
        ok: true,
        data: consensus,
      });
    } catch (err: any) {
      console.error('[SPX Consensus] Compute error:', err);
      return reply.status(500).send({
        ok: false,
        error: err.message || 'Consensus computation failed',
      });
    }
  });

  console.log('[SPX Consensus] Routes registered');
}
