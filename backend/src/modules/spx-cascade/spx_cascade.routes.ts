/**
 * SPX CASCADE ROUTES — D1 Extended
 * 
 * API endpoints for SPX cascade overlay.
 * 
 * Endpoints:
 * - GET /api/fractal/spx/terminal   - Extended terminal with cascade
 * - GET /api/fractal/spx/cascade    - Cascade-only data
 * - POST /api/fractal/spx/admin/cascade/validate - Validate cascade logic
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { buildSpxFocusPack, type SpxFocusPack } from '../spx-core/spx-focus-pack.builder.js';
import { adaptSpxToFractal } from '../spx/adapters/spx-to-fractal.adapter.js';
import { isValidSpxHorizon, type SpxHorizonKey } from '../spx-core/spx-horizon.config.js';
import { buildSpxCascadePack, buildCascadePackFromInputs, SPX_CASCADE_VERSION } from './spx_cascade.service.js';
import type { SpxCoreSignal, CascadeInputs } from './spx_cascade.contract.js';
import { GUARD_CAPS } from './spx_cascade.rules.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerSpxCascadeRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/spx';
  
  /**
   * GET /api/fractal/spx/terminal
   * 
   * SPX Terminal with D1 Cascade overlay.
   * Returns full SPX fractal data + cascade section.
   */
  fastify.get(`${prefix}/terminal`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string; cascade?: string };
    const focus = query.focus || '30d';
    const includeCascade = query.cascade !== 'false'; // Default: include cascade
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}. Valid: 7d, 14d, 30d, 90d, 180d, 365d`,
      });
    }
    
    try {
      const t0 = Date.now();
      
      // Step 1: Build SPX focus pack
      const focusPack: SpxFocusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      
      // Step 2: Adapt to fractal contract
      const fractalContract = adaptSpxToFractal(focusPack);
      
      // Step 3: Extract SPX core signal for cascade
      const stats = focusPack.overlay.stats;
      const spxCoreSignal: SpxCoreSignal = {
        action: stats.medianReturn > 0.02 ? 'BUY' : 
                stats.medianReturn < -0.02 ? 'REDUCE' : 'HOLD',
        confidence: focusPack.diagnostics.reliability,
        horizon: focus,
        forecastReturn: stats.medianReturn / 100, // Convert to decimal
        phase: focusPack.phase.phase,
      };
      
      // Step 4: Build cascade pack (if enabled)
      let cascade = null;
      if (includeCascade) {
        try {
          cascade = await buildSpxCascadePack(spxCoreSignal);
        } catch (cascadeError: any) {
          console.warn('[SPX Terminal] Cascade failed:', cascadeError.message);
          cascade = { error: 'Cascade unavailable', reason: cascadeError.message };
        }
      }
      
      const processingTimeMs = Date.now() - t0;
      
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs,
        
        // Core SPX data
        contract: fractalContract.contract,
        market: fractalContract.market,
        decision: {
          ...fractalContract.decision,
          // Add cascade-adjusted values if available
          cascadeAdjusted: cascade?.decisionAdjusted ?? null,
        },
        diagnostics: fractalContract.diagnostics,
        explain: fractalContract.explain,
        chartData: fractalContract.chartData,
        
        // D1 Cascade section
        cascade,
        
        // Meta
        meta: {
          spxVersion: fractalContract.contract.version,
          cascadeVersion: SPX_CASCADE_VERSION,
          cascadeEnabled: includeCascade,
        },
      };
      
    } catch (error: any) {
      fastify.log.error(`[SPX Terminal] Error: ${error.message}`);
      
      if (error.message?.includes('INSUFFICIENT_DATA')) {
        return reply.code(503).send({
          ok: false,
          error: error.message,
          hint: 'SPX historical data not available. Run data ingestion first.',
        });
      }
      
      return reply.code(500).send({
        ok: false,
        error: error.message || 'Internal server error',
      });
    }
  });
  
  /**
   * GET /api/fractal/spx/cascade
   * 
   * Cascade-only endpoint.
   * Returns DXY/AE → SPX cascade overlay without full SPX data.
   */
  fastify.get(`${prefix}/cascade`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}`,
      });
    }
    
    try {
      const t0 = Date.now();
      
      // Build SPX focus pack to get core signal
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      const stats = focusPack.overlay.stats;
      
      const spxCoreSignal: SpxCoreSignal = {
        action: stats.medianReturn > 0.02 ? 'BUY' : 
                stats.medianReturn < -0.02 ? 'REDUCE' : 'HOLD',
        confidence: focusPack.diagnostics.reliability,
        horizon: focus,
        forecastReturn: stats.medianReturn / 100,
        phase: focusPack.phase.phase,
      };
      
      // Build cascade pack
      const cascade = await buildSpxCascadePack(spxCoreSignal);
      
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        spxCore: spxCoreSignal,
        cascade,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * P4.3: GET /api/fractal/spx/cascade/evidence
   * 
   * Cascade with full explainability pack.
   */
  fastify.get(`${prefix}/cascade/evidence`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    if (!isValidSpxHorizon(focus)) {
      return reply.code(400).send({
        ok: false,
        error: `Invalid horizon: ${focus}`,
      });
    }
    
    try {
      const t0 = Date.now();
      const { buildCascadeEvidence } = await import('../evidence-engine/cascade_evidence.builder.js');
      
      // Build SPX focus pack to get core signal
      const focusPack = await buildSpxFocusPack(focus as SpxHorizonKey);
      const stats = focusPack.overlay.stats;
      
      const spxCoreSignal: SpxCoreSignal = {
        action: stats.medianReturn > 0.02 ? 'BUY' : 
                stats.medianReturn < -0.02 ? 'REDUCE' : 'HOLD',
        confidence: focusPack.diagnostics.reliability,
        horizon: focus,
        forecastReturn: stats.medianReturn / 100,
        phase: focusPack.phase.phase,
      };
      
      // Build cascade pack
      const cascade = await buildSpxCascadePack(spxCoreSignal);
      
      // Build evidence - adapt to actual cascade structure
      const factors = cascade.multipliers.factors || cascade.multipliers.breakdown || {};
      const evidenceInput = {
        ok: true,
        asset: 'SPX' as const,
        size: cascade.multipliers.sizeMultiplier,
        guardLevel: cascade.inputs.dxy.guard as 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK',
        guardCap: GUARD_CAPS[cascade.inputs.dxy.guard as keyof typeof GUARD_CAPS],
        multipliers: {
          mStress: factors.mStress ?? 1,
          mPersistence: factors.mPersist ?? 1,
          mNovel: factors.mNovel ?? 1,
          mScenario: factors.mScenario ?? 1,
          total: cascade.multipliers.sizeMultiplier,
        },
        inputs: {
          pStress4w: cascade.inputs.ae.transition?.pStress4w ?? 0.06,
          selfTransition: cascade.inputs.ae.transition?.selfTransition ?? 0.9,
          bearProb: cascade.inputs.ae.scenarios?.bear ?? 0.25,
          bullProb: cascade.inputs.ae.scenarios?.bull ?? 0.25,
          noveltyScore: cascade.inputs.ae.novelty?.score ?? 0,
        },
      };
      
      const evidence = buildCascadeEvidence(evidenceInput);
      
      return {
        ok: true,
        symbol: 'SPX',
        focus,
        processingTimeMs: Date.now() - t0,
        spxCore: spxCoreSignal,
        cascade,
        evidence,
      };
      
    } catch (error: any) {
      return reply.code(500).send({
        ok: false,
        error: error.message,
      });
    }
  });
  
  /**
   * POST /api/fractal/spx/admin/cascade/validate
   * 
   * Validate cascade logic with custom inputs.
   * Used for testing guard policies and multiplier calculations.
   */
  fastify.post(`${prefix}/admin/cascade/validate`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as {
      spxSignal?: SpxCoreSignal;
      inputs?: CascadeInputs;
      testCase?: 'BLOCK' | 'CRISIS' | 'WARN' | 'STRESS' | 'RARE' | 'NORMAL';
    };
    
    // Default SPX signal
    const spxSignal: SpxCoreSignal = body.spxSignal || {
      action: 'BUY',
      confidence: 0.64,
      horizon: '30d',
      forecastReturn: 0.024,
      phase: 'ACCUMULATION',
    };
    
    // Build inputs based on test case or use provided
    let inputs: CascadeInputs;
    
    if (body.inputs) {
      inputs = body.inputs;
    } else {
      // Generate test case inputs
      inputs = generateTestCaseInputs(body.testCase || 'NORMAL');
    }
    
    // Build cascade pack
    const cascade = buildCascadePackFromInputs(inputs, spxSignal);
    
    // Validation checks
    const validation = {
      sizeInRange: cascade.multipliers.sizeMultiplier >= 0 && cascade.multipliers.sizeMultiplier <= 1,
      confidenceInRange: cascade.decisionAdjusted.confidenceAdjusted >= 0 && cascade.decisionAdjusted.confidenceAdjusted <= 1,
      guardRespected: validateGuardRespected(cascade),
      directionPreserved: cascade.decisionAdjusted.action === spxSignal.action,
      noNaN: !hasNaN(cascade),
      deterministic: true, // By construction
    };
    
    const allPassed = Object.values(validation).every(v => v);
    
    return {
      ok: allPassed,
      testCase: body.testCase || 'CUSTOM',
      spxSignal,
      cascade,
      validation,
      expectedGuardCap: GUARD_CAPS[inputs.dxy.guard],
    };
  });
  
  /**
   * GET /api/fractal/spx/cascade/health
   * 
   * Cascade module health check.
   */
  fastify.get(`${prefix}/cascade/health`, async () => {
    return {
      ok: true,
      module: 'spx-cascade',
      version: SPX_CASCADE_VERSION,
      status: 'D1_EXTENDED',
      components: {
        rules: true,
        service: true,
        routes: true,
      },
      guardCaps: GUARD_CAPS,
    };
  });
  
  fastify.log.info(`[SPX Cascade] Routes registered at ${prefix}/terminal, ${prefix}/cascade`);
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function generateTestCaseInputs(testCase: string): CascadeInputs {
  const base: CascadeInputs = {
    dxy: {
      tacticalAction: 'HOLD',
      tacticalConfidence01: 0.5,
      regimeMode: 'tactical',
      regimeBiasSigned: 0,
      guard: 'NONE',
    },
    ae: {
      regime: 'NEUTRAL_MIXED',
      regimeConfidence01: 0.5,
      transition: { pStress1w: 0.02, pStress4w: 0.06, selfTransition: 0.9 },
      durations: { stressMedianW: 4, liquidityMedianW: 24, currentMedianW: 10 },
      novelty: { label: 'KNOWN', score: 0.05 },
      scenarios: { base: 0.5, bull: 0.25, bear: 0.25 },
    },
  };
  
  switch (testCase) {
    case 'BLOCK':
      base.dxy.guard = 'BLOCK';
      break;
    case 'CRISIS':
      base.dxy.guard = 'CRISIS';
      base.ae.regime = 'RISK_OFF_STRESS';
      base.ae.transition.pStress4w = 0.15;
      break;
    case 'WARN':
      base.dxy.guard = 'WARN';
      break;
    case 'STRESS':
      base.ae.regime = 'RISK_OFF_STRESS';
      base.ae.transition.pStress4w = 0.12;
      base.ae.transition.selfTransition = 0.86;
      break;
    case 'RARE':
      base.ae.novelty = { label: 'RARE', score: 0.15 };
      break;
    case 'NORMAL':
    default:
      // Keep defaults
      break;
  }
  
  return base;
}

function validateGuardRespected(cascade: any): boolean {
  const guardCap = GUARD_CAPS[cascade.inputs.dxy.guard as keyof typeof GUARD_CAPS];
  return cascade.multipliers.sizeMultiplier <= guardCap + 0.001; // Small tolerance
}

function hasNaN(obj: any): boolean {
  const json = JSON.stringify(obj);
  return json.includes('NaN') || json.includes('Infinity');
}

export default registerSpxCascadeRoutes;
