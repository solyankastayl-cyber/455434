/**
 * AE/S-Brain v2 — Routes
 * 
 * Endpoints:
 * - GET /api/brain/v2/world — WorldStatePack
 * - GET /api/brain/v2/decision — BrainOutputPack
 * - POST /api/brain/v2/apply-overrides — Test override application
 * - GET /api/brain/v2/status — Brain status
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getWorldStateService } from '../services/world_state.service.js';
import { getBrainOrchestratorService } from '../services/brain_orchestrator.service.js';
import { getBrainOverrideApplyService, EngineOutput } from '../services/brain_override_apply.service.js';
import { BrainOutputPack } from '../contracts/brain_output.contract.js';

export async function brainRoutes(fastify: FastifyInstance): Promise<void> {
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/world — Get complete world state
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/world', async (
    request: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      const worldService = getWorldStateService();
      const world = await worldService.buildWorldState(asOf);
      
      return reply.send(world);
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'WORLD_STATE_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/decision — Get brain decision
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/decision', async (
    request: FastifyRequest<{ Querystring: { asOf?: string; withForecast?: string } }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    const withForecast = request.query.withForecast === '1' || request.query.withForecast === 'true';
    
    try {
      const brainService = getBrainOrchestratorService();
      const decision = await brainService.computeDecision(asOf, withForecast);
      
      return reply.send(decision);
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'BRAIN_DECISION_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // POST /api/brain/v2/apply-overrides — Test override application
  // ─────────────────────────────────────────────────────────────
  
  fastify.post('/api/brain/v2/apply-overrides', async (
    request: FastifyRequest<{
      Body: {
        engineOutput: EngineOutput;
        brainOutput?: BrainOutputPack;
      };
    }>,
    reply: FastifyReply
  ) => {
    const { engineOutput, brainOutput } = request.body || {};
    
    if (!engineOutput) {
      return reply.status(400).send({
        ok: false,
        error: 'MISSING_ENGINE_OUTPUT',
      });
    }
    
    try {
      // If no brain output provided, compute fresh
      let brain = brainOutput;
      if (!brain) {
        const brainService = getBrainOrchestratorService();
        brain = await brainService.computeDecision(new Date().toISOString().split('T')[0]);
      }
      
      const applyService = getBrainOverrideApplyService();
      const result = applyService.applyOverrides(engineOutput, brain);
      
      return reply.send({
        ok: true,
        original: engineOutput,
        brainDecision: brain,
        applied: result,
        wouldChange: applyService.wouldChangeAnything(engineOutput, brain),
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'APPLY_OVERRIDES_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/status — Brain status and config
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/status', async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    return reply.send({
      ok: true,
      brainVersion: 'v2.1.0-moe',
      engineVersion: 'v2',
      status: 'ACTIVE',
      capabilities: [
        'world_state_aggregation',
        'quantile_forecast_moe',
        'probabilistic_scenario_engine',
        'forecast_driven_overrides',
        'tail_amplification',
        'bull_extension',
        'neutral_dampening',
        'evidence_extraction',
        'override_application',
        'shadow_mode',
      ],
      flow: 'WorldState → Quantile Forecast (MoE) → Scenario Engine → Risk Engine → Directives → EngineGlobal',
      thresholds: {
        stressProbRiskOff: 0.35,
        tailRiskThreshold: 0.35,
        tailModeThreshold: 0.50,
        bullTailRiskMax: 0.20,
        dampeningFactor: 0.90,
        crisisBtcHaircut: 0.60,
        crisisSpxHaircut: 0.75,
        warnBtcHaircut: 0.85,
        warnSpxHaircut: 0.90,
        blockMaxSize: 0.05,
        tailQ05Thresholds: { '30D': '-3%', '90D': '-6%', '180D': '-10%', '365D': '-15%' },
      },
      rules: [
        'GUARD BLOCK → all risk assets capped to 5% (absolute priority)',
        'GUARD CRISIS → BTC haircut 60%, SPX haircut 75%',
        'GUARD WARN → BTC haircut 85%, SPX haircut 90%',
        'TAIL AMP: q05 < threshold → amplify haircut by haircutScale',
        'BULL EXT: mean > 0 AND tailRisk < 0.2 AND guard=NONE → sizeScale 1.1',
        'DAMPEN: spread > threshold → allocations × 0.9',
        'P(TAIL) = clamp01(tailRisk * 0.8)',
        'P(RISK) = clamp01(regime_p_stress * 0.7 + vol_spike * 0.3)',
        'CONTRACTION + negative macro → extra BTC haircut',
      ],
    });
  });
  
  // ─────────────────────────────────────────────────────────────
  // GET /api/brain/v2/summary — Quick summary for dashboard
  // ─────────────────────────────────────────────────────────────
  
  fastify.get('/api/brain/v2/summary', async (
    request: FastifyRequest<{ Querystring: { asOf?: string } }>,
    reply: FastifyReply
  ) => {
    const asOf = request.query.asOf || new Date().toISOString().split('T')[0];
    
    try {
      const brainService = getBrainOrchestratorService();
      const decision = await brainService.computeDecision(asOf, true);
      
      // Return condensed summary with forecast info
      return reply.send({
        ok: true,
        asOf,
        brainVersion: decision.meta.brainVersion,
        scenario: decision.scenario.name,
        scenarioProbs: decision.scenario.probs,
        riskMode: decision.directives.riskMode,
        headline: decision.evidence.headline,
        drivers: decision.evidence.drivers.slice(0, 7),
        warnings: decision.directives.warnings,
        haircuts: decision.directives.haircuts,
        caps: decision.directives.caps,
        scales: decision.directives.scales,
        overrideReasoning: (decision as any).overrideReasoning,
        forecastSummary: decision.forecasts?.dxy ? {
          byHorizon: decision.forecasts.dxy.byHorizon,
        } : undefined,
      });
    } catch (e) {
      return reply.status(500).send({
        ok: false,
        error: 'BRAIN_SUMMARY_ERROR',
        message: (e as Error).message,
      });
    }
  });
  
  console.log('[Brain] Routes registered at /api/brain/v2/*');
}
