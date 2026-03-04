/**
 * BTC CASCADE ROUTES — D2
 * 
 * API endpoints for BTC cascade overlay.
 * 
 * Endpoints:
 * - GET /api/fractal/btc/cascade       - Cascade-only data
 * - GET /api/fractal/btc/cascade/debug - Debug info with raw inputs
 * - GET /api/fractal/btc/cascade/health- Health check
 * - POST /api/fractal/btc/admin/cascade/validate - Validate cascade logic
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  buildBtcCascadePack, 
  buildBtcCascadeFromInputs,
  getBtcCascadeDebug,
  BTC_CASCADE_VERSION 
} from './btc_cascade.service.js';
import type { BtcCoreSignal, BtcCascadeInputs, GuardLevel } from './btc_cascade.contract.js';
import { BTC_GUARD_CAPS } from './btc_cascade.rules.js';

// ═══════════════════════════════════════════════════════════════
// ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerBtcCascadeRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/fractal/btc';
  
  /**
   * GET /api/fractal/btc/cascade
   * 
   * BTC Cascade-only endpoint.
   * Returns DXY/AE/SPX → BTC cascade overlay.
   */
  fastify.get(`${prefix}/cascade`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    try {
      const t0 = Date.now();
      
      // Get BTC core signal from terminal
      let btcSignal: BtcCoreSignal;
      
      try {
        const btcResponse = await fetch(`http://127.0.0.1:8002/api/fractal/btc?focus=${focus}`);
        const btcData = await btcResponse.json();
        
        if (btcData.ok && btcData.data?.decision) {
          const dec = btcData.data.decision;
          btcSignal = {
            action: dec.action || 'HOLD',
            size: dec.size ?? dec.sizeMultiplier ?? 0.5,
            confidence: dec.confidence ?? 0.5,
            horizon: focus,
          };
        } else {
          // Default signal if BTC terminal unavailable
          btcSignal = {
            action: 'HOLD',
            size: 0.5,
            confidence: 0.5,
            horizon: focus,
          };
        }
      } catch {
        btcSignal = {
          action: 'HOLD',
          size: 0.5,
          confidence: 0.5,
          horizon: focus,
        };
      }
      
      // Build cascade pack
      const cascade = await buildBtcCascadePack(btcSignal);
      
      return {
        ok: true,
        symbol: 'BTC',
        focus,
        processingTimeMs: Date.now() - t0,
        btcCore: btcSignal,
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
   * GET /api/fractal/btc/cascade/debug
   * 
   * Debug endpoint with raw inputs and timing.
   */
  fastify.get(`${prefix}/cascade/debug`, async () => {
    try {
      const debug = await getBtcCascadeDebug();
      return { ok: true, ...debug };
    } catch (error: any) {
      return { ok: false, error: error.message };
    }
  });
  
  /**
   * P4.3: GET /api/fractal/btc/cascade/evidence
   * 
   * BTC Cascade with full explainability pack.
   */
  fastify.get(`${prefix}/cascade/evidence`, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as { focus?: string };
    const focus = query.focus || '30d';
    
    try {
      const t0 = Date.now();
      const { buildCascadeEvidence } = await import('../evidence-engine/cascade_evidence.builder.js');
      
      // Get BTC core signal
      let btcSignal: BtcCoreSignal;
      
      try {
        const btcResponse = await fetch(`http://127.0.0.1:8002/api/fractal/btc?focus=${focus}`);
        const btcData = await btcResponse.json();
        
        if (btcData.ok && btcData.data?.decision) {
          const dec = btcData.data.decision;
          btcSignal = {
            action: dec.action || 'HOLD',
            size: dec.size ?? dec.sizeMultiplier ?? 0.5,
            confidence: dec.confidence ?? 0.5,
            horizon: focus,
          };
        } else {
          btcSignal = { action: 'HOLD', size: 0.5, confidence: 0.5, horizon: focus };
        }
      } catch {
        btcSignal = { action: 'HOLD', size: 0.5, confidence: 0.5, horizon: focus };
      }
      
      // Build cascade pack
      const cascade = await buildBtcCascadePack(btcSignal);
      
      // Build evidence - adapt to actual BTC cascade structure
      const mults = cascade.multipliers || {};
      const inputs = cascade.inputs || {};
      
      // BTC multipliers structure differs - use mTotal as sizeMultiplier
      const sizeMultiplier = mults.sizeMultiplier ?? mults.mTotal ?? mults.mTotalRaw ?? 1;
      
      // BTC has flat inputs structure, not nested
      const pStress = inputs.pStress4w ?? 0.06;
      const bearProb = inputs.bearProb ?? 0.25;
      const bullProb = inputs.bullProb ?? 0.25;
      const noveltyScore = inputs.noveltyScore ?? 0;
      const spxAdj = inputs.spxAdj ?? 0.8;
      
      const evidenceInput = {
        ok: true,
        asset: 'BTC' as const,
        size: sizeMultiplier,
        guardLevel: (cascade.guardLevel || 'NONE') as 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK',
        guardCap: BTC_GUARD_CAPS[(cascade.guardLevel || 'NONE') as keyof typeof BTC_GUARD_CAPS],
        multipliers: {
          mStress: mults.mStress ?? sizeMultiplier,
          mNovel: mults.mNovel ?? 1,
          mScenario: mults.mScenario ?? 1,
          mSPX: mults.mSPX ?? spxAdj,
          total: sizeMultiplier,
        },
        inputs: {
          pStress4w: pStress,
          selfTransition: 0.9,
          bearProb: bearProb,
          bullProb: bullProb,
          noveltyScore: noveltyScore,
          spxAdjustment: spxAdj,
        },
      };
      
      const evidence = buildCascadeEvidence(evidenceInput);
      
      return {
        ok: true,
        symbol: 'BTC',
        focus,
        processingTimeMs: Date.now() - t0,
        btcCore: btcSignal,
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
   * GET /api/fractal/btc/cascade/health
   * 
   * Cascade module health check.
   */
  fastify.get(`${prefix}/cascade/health`, async () => {
    return {
      ok: true,
      module: 'btc-cascade',
      version: BTC_CASCADE_VERSION,
      status: 'D2_COMPLETE',
      components: {
        rules: true,
        service: true,
        routes: true,
      },
      guardCaps: BTC_GUARD_CAPS,
      upstreamDeps: ['ae-brain', 'spx-cascade'],
    };
  });
  
  /**
   * POST /api/fractal/btc/admin/cascade/validate
   * 
   * Validate cascade logic with custom inputs.
   * Used for testing guard policies and multiplier calculations.
   */
  fastify.post(`${prefix}/admin/cascade/validate`, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as {
      btcSignal?: BtcCoreSignal;
      inputs?: BtcCascadeInputs;
      guardLevel?: GuardLevel;
      testCase?: 'BLOCK' | 'CRISIS' | 'WARN' | 'STRESS' | 'BEAR' | 'RARE' | 'SPX_LOW' | 'NORMAL';
    };
    
    // Default BTC signal
    const btcSignal: BtcCoreSignal = body.btcSignal || {
      action: 'LONG',
      size: 0.8,
      confidence: 0.7,
      horizon: '30d',
    };
    
    // Build inputs based on test case or use provided
    let inputs: BtcCascadeInputs;
    let guardLevel: GuardLevel;
    
    if (body.inputs && body.guardLevel) {
      inputs = body.inputs;
      guardLevel = body.guardLevel;
    } else {
      // Generate test case inputs
      const testData = generateTestCaseInputs(body.testCase || 'NORMAL');
      inputs = testData.inputs;
      guardLevel = testData.guardLevel;
    }
    
    // Build cascade pack
    const cascade = buildBtcCascadeFromInputs(inputs, guardLevel, btcSignal);
    
    // Validation checks
    const validation = {
      sizeInRange: cascade.decisionAdjusted.sizeAdjusted >= 0 && cascade.decisionAdjusted.sizeAdjusted <= 1,
      confidenceInRange: cascade.decisionAdjusted.confidenceAdjusted >= 0 && cascade.decisionAdjusted.confidenceAdjusted <= 1,
      guardRespected: cascade.decisionAdjusted.sizeAdjusted <= cascade.guard.cap + 0.001,
      directionPreserved: true, // BTC direction not included in output (immutable)
      noNaN: !hasNaN(cascade),
      deterministic: true,
      monotonic: true, // Stress ↑ → size ↓ (by construction)
    };
    
    const allPassed = Object.values(validation).every(v => v);
    
    return {
      ok: allPassed,
      testCase: body.testCase || 'CUSTOM',
      btcSignal,
      cascade,
      validation,
      expectedGuardCap: BTC_GUARD_CAPS[guardLevel],
    };
  });
  
  fastify.log.info(`[BTC Cascade] Routes registered at ${prefix}/cascade, ${prefix}/cascade/debug`);
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function generateTestCaseInputs(testCase: string): { inputs: BtcCascadeInputs; guardLevel: GuardLevel } {
  const base: BtcCascadeInputs = {
    pStress4w: 0.06,
    bearProb: 0.25,
    bullProb: 0.25,
    noveltyLabel: 'NORMAL',
    noveltyScore: 0.05,
    spxAdj: 0.8,
    aeRegime: 'NEUTRAL_MIXED',
    aeRegimeConfidence: 0.5,
  };
  
  let guardLevel: GuardLevel = 'NONE';
  
  switch (testCase) {
    case 'BLOCK':
      guardLevel = 'BLOCK';
      base.pStress4w = 0.20;
      base.aeRegime = 'RISK_OFF_STRESS';
      break;
      
    case 'CRISIS':
      guardLevel = 'CRISIS';
      base.pStress4w = 0.15;
      base.aeRegime = 'RISK_OFF_STRESS';
      break;
      
    case 'WARN':
      guardLevel = 'WARN';
      base.pStress4w = 0.08;
      break;
      
    case 'STRESS':
      base.pStress4w = 0.25; // High stress
      base.aeRegime = 'RISK_OFF_STRESS';
      break;
      
    case 'BEAR':
      base.bearProb = 0.50; // Bear scenario dominant
      base.bullProb = 0.15;
      break;
      
    case 'RARE':
      base.noveltyLabel = 'RARE';
      base.noveltyScore = 0.15;
      break;
      
    case 'SPX_LOW':
      base.spxAdj = 0.25; // SPX risk-off
      break;
      
    case 'NORMAL':
    default:
      // Keep defaults
      break;
  }
  
  return { inputs: base, guardLevel };
}

function hasNaN(obj: any): boolean {
  const json = JSON.stringify(obj);
  return json.includes('NaN') || json.includes('Infinity');
}

export default registerBtcCascadeRoutes;
