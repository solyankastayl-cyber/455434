/**
 * P11 — Optimizer Routes
 * 
 * GET  /api/brain/v2/optimizer/preview   — Preview optimizer deltas
 * GET  /api/brain/v2/optimizer/schema    — Schema documentation
 * POST /api/brain/v2/optimizer/simulate  — Simulate with custom inputs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getOptimizerService } from './optimizer.service.js';
import { validateOptimizerOutput, OPTIMIZER_PARAMS, OptimizerInput } from './optimizer.contract.js';
import { getMetaRiskService } from '../services/meta_risk.service.js';
import { getRegimeMemoryService } from '../services/regime_memory.service.js';
import { getBrainOrchestratorService } from '../services/brain_orchestrator.service.js';
import { getEngineGlobalWithBrain } from '../../engine-global/engine_global_brain_bridge.service.js';

export async function optimizerRoutes(fastify: FastifyInstance): Promise<void> {

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/optimizer/preview
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/optimizer/preview', async (
    request: FastifyRequest<{
      Querystring: { asOf?: string }
    }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      // Build optimizer input from current state
      const input = await buildOptimizerInput(asOf);
      
      const service = getOptimizerService();
      const result = service.preview(input);
      
      const validation = validateOptimizerOutput(result);
      
      return reply.send({
        ok: true,
        ...result,
        input: {
          allocations: input.allocations,
          posture: input.posture,
          scenario: input.scenario,
          crossAssetRegime: input.crossAssetRegime,
          contagionScore: input.contagionScore,
        },
        validation: {
          valid: validation.valid,
          errors: validation.errors.length > 0 ? validation.errors : undefined,
        },
      });
    } catch (e) {
      console.error('[Optimizer] Preview error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'OPTIMIZER_PREVIEW_ERROR',
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────
  // GET /api/brain/v2/optimizer/schema
  // ─────────────────────────────────────────────────────────

  fastify.get('/api/brain/v2/optimizer/schema', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      version: 'P11',
      description: 'Capital Allocation Optimizer - small deltas wrapper',
      philosophy: [
        'Does NOT replace Brain',
        'Small deltas only (max 0.15)',
        'Always explainable',
        'Safety-first constraints',
      ],
      params: OPTIMIZER_PARAMS,
      formula: {
        score: 'expectedTilt - tailPenalty - corrPenalty - guardPenalty',
        delta: 'clamp(score * K, -maxDelta, +maxDelta)',
        components: {
          expectedTilt: 'mean * W_RETURN',
          tailPenalty: 'abs(q05) * W_TAIL',
          corrPenalty: 'contagionScore * W_CORR',
          guardPenalty: 'posture==DEFENSIVE ? W_GUARD : 0',
        },
      },
      constraints: {
        TAIL: 'delta(spx,btc) ≤ 0 (only risk reduction)',
        RISK_OFF_SYNC: 'btcDelta ≤ spxDelta (BTC cut harder)',
        DEFENSIVE: 'maxDelta = 0.08',
      },
      endpoints: {
        preview: 'GET /api/brain/v2/optimizer/preview?asOf=YYYY-MM-DD',
        withEngine: 'GET /api/engine/global?brain=1&optimizer=1',
        simulate: 'POST /api/brain/v2/optimizer/simulate',
      },
    });
  });

  // ─────────────────────────────────────────────────────────
  // POST /api/brain/v2/optimizer/simulate
  // ─────────────────────────────────────────────────────────

  fastify.post('/api/brain/v2/optimizer/simulate', async (
    request: FastifyRequest<{
      Body: Partial<OptimizerInput>
    }>,
    reply: FastifyReply
  ) => {
    const body = request.body || {};
    const asOf = body.asOf || new Date().toISOString().split('T')[0];
    
    try {
      // Get base input
      const baseInput = await buildOptimizerInput(asOf);
      
      // Override with provided values
      const input: OptimizerInput = {
        asOf,
        allocations: body.allocations || baseInput.allocations,
        posture: body.posture || baseInput.posture,
        scenario: body.scenario || baseInput.scenario,
        crossAssetRegime: body.crossAssetRegime || baseInput.crossAssetRegime,
        contagionScore: body.contagionScore ?? baseInput.contagionScore,
        forecasts: body.forecasts || baseInput.forecasts,
      };
      
      const service = getOptimizerService();
      const result = service.compute(input, 'on');
      
      return reply.send({
        ok: true,
        simulated: true,
        ...result,
        inputUsed: input,
      });
    } catch (e) {
      console.error('[Optimizer] Simulate error:', e);
      return reply.status(500).send({
        ok: false,
        error: 'OPTIMIZER_SIMULATE_ERROR',
        message: (e as Error).message,
      });
    }
  });

  console.log('[Optimizer] P11 Routes registered at /api/brain/v2/optimizer/*');
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Build OptimizerInput from current state
// ═══════════════════════════════════════════════════════════════

async function buildOptimizerInput(asOf: string): Promise<OptimizerInput> {
  // Get current brain+engine allocations
  const engineResult = await getEngineGlobalWithBrain({ asOf, brain: true, brainMode: 'on' });
  const allocations = {
    spx: engineResult.allocations?.spxSize || 0,
    btc: engineResult.allocations?.btcSize || 0,
    cash: engineResult.allocations?.cashSize || 0,
  };
  
  // Normalize
  const sum = allocations.spx + allocations.btc + allocations.cash || 1;
  allocations.spx /= sum;
  allocations.btc /= sum;
  allocations.cash /= sum;
  
  // Get MetaRisk for posture
  const brainDecision = engineResult.brain?.decision;
  const brainScenario = brainDecision?.scenario ? {
    scenario: brainDecision.scenario.name,
    pTail: brainDecision.scenario.probabilities?.pTail || 0,
    pRisk: brainDecision.scenario.probabilities?.pRisk || 0,
  } : undefined;
  
  const metaRisk = await getMetaRiskService().getMetaRisk(asOf, brainScenario);
  const posture = metaRisk.posture;
  
  // Get scenario from Brain
  const scenario = (brainDecision?.scenario?.name as 'BASE' | 'RISK' | 'TAIL') || 'BASE';
  
  // Get regime memory for cross-asset
  const regimeMemory = await getRegimeMemoryService().getCurrent(asOf);
  const crossAssetRegime = regimeMemory.crossAsset.current;
  
  // Estimate contagion score from cross-asset regime
  let contagionScore = 0.3; // default
  if (crossAssetRegime === 'RISK_OFF_SYNC') contagionScore = 0.8;
  else if (crossAssetRegime === 'FLIGHT_TO_QUALITY') contagionScore = 0.7;
  else if (crossAssetRegime === 'DECOUPLED') contagionScore = 0.2;
  else if (crossAssetRegime === 'RISK_ON_SYNC') contagionScore = 0.4;
  
  // Get forecasts (simplified - use directives if available)
  const forecasts = {
    spx: {
      mean: brainDecision?.directives?.scales?.spx?.sizeScale ?? 0.02,
      q05: -(brainDecision?.directives?.haircuts?.spx ?? 0.05),
      tailRisk: brainDecision?.evidence?.tailRisk ?? 0.3,
    },
    btc: {
      mean: brainDecision?.directives?.scales?.btc?.sizeScale ?? 0.03,
      q05: -(brainDecision?.directives?.haircuts?.btc ?? 0.08),
      tailRisk: brainDecision?.evidence?.tailRisk ?? 0.4,
    },
  };
  
  return {
    asOf,
    allocations,
    posture,
    scenario,
    crossAssetRegime,
    contagionScore,
    forecasts,
  };
}
