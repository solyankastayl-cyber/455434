/**
 * P3.3 BIAS CHECK ROUTES
 * 
 * Compares standard validation vs honest as-of validation.
 * This is the ultimate test for lookahead bias.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { runSpxOosValidation, runSpxOosValidationAsOf } from '../spx-cascade/spx_validation.service.js';
import { runBtcOosValidation, runBtcOosValidationAsOf } from '../btc-cascade/validation/btc_validation.service.js';

interface BiasCheckResult {
  ok: boolean;
  asset: 'SPX' | 'BTC';
  period: { from: string; to: string };
  standard: {
    equity: number;
    maxDD: number;
    volatility: number;
    hitRate: number;
  };
  asOf: {
    equity: number;
    maxDD: number;
    volatility: number;
    hitRate: number;
  };
  delta: {
    equityDiffPct: number;
    maxDDDiffPct: number;
    volatilityDiffPct: number;
    hitRateDiff: number;
  };
  biasAssessment: {
    clean: boolean;
    severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    notes: string[];
  };
  durationMs: number;
}

function assessBias(delta: BiasCheckResult['delta']): BiasCheckResult['biasAssessment'] {
  const notes: string[] = [];
  
  // Check equity difference
  const eqDiff = Math.abs(delta.equityDiffPct);
  const ddDiff = Math.abs(delta.maxDDDiffPct);
  const volDiff = Math.abs(delta.volatilityDiffPct);
  const hrDiff = Math.abs(delta.hitRateDiff);
  
  let severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' = 'NONE';
  
  // Equity assessment
  if (eqDiff < 5) {
    notes.push(`Equity difference ${eqDiff.toFixed(1)}% - acceptable`);
  } else if (eqDiff < 10) {
    notes.push(`Equity difference ${eqDiff.toFixed(1)}% - minor lookahead possible`);
    if (severity === 'NONE') severity = 'LOW';
  } else if (eqDiff < 20) {
    notes.push(`Equity difference ${eqDiff.toFixed(1)}% - significant lookahead bias`);
    if (severity !== 'HIGH') severity = 'MEDIUM';
  } else {
    notes.push(`Equity difference ${eqDiff.toFixed(1)}% - severe lookahead bias`);
    severity = 'HIGH';
  }
  
  // MaxDD assessment
  if (ddDiff < 5) {
    notes.push(`MaxDD difference ${ddDiff.toFixed(1)}% - acceptable`);
  } else if (ddDiff < 15) {
    notes.push(`MaxDD difference ${ddDiff.toFixed(1)}% - minor variance`);
  } else {
    notes.push(`MaxDD difference ${ddDiff.toFixed(1)}% - significant variance in risk profile`);
    if (severity === 'NONE' || severity === 'LOW') severity = 'MEDIUM';
  }
  
  // Hit rate assessment
  if (hrDiff < 0.03) {
    notes.push(`Hit rate difference ${(hrDiff * 100).toFixed(1)}% - acceptable`);
  } else {
    notes.push(`Hit rate difference ${(hrDiff * 100).toFixed(1)}% - signal timing may have future info`);
    if (severity === 'NONE') severity = 'LOW';
  }
  
  const clean = severity === 'NONE' || severity === 'LOW';
  
  if (clean) {
    notes.unshift('SYSTEM CLEAN - No significant lookahead bias detected');
  } else {
    notes.unshift('LOOKAHEAD BIAS DETECTED - Review rolling windows and score calculations');
  }
  
  return { clean, severity, notes };
}

export async function registerP33BiasCheckRoutes(fastify: FastifyInstance): Promise<void> {
  const prefix = '/api/p33';
  
  /**
   * POST /api/p33/bias-check/spx
   * 
   * Run SPX bias check: standard vs as-of validation.
   */
  fastify.post(`${prefix}/bias-check/spx`, async (req: FastifyRequest): Promise<BiasCheckResult> => {
    const t0 = Date.now();
    const body = (req.body ?? {}) as { from?: string; to?: string };
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    
    console.log(`[P3.3] Running SPX bias check ${from} → ${to}`);
    
    // Run both validations
    const [standard, asOf] = await Promise.all([
      runSpxOosValidation(from, to, '30d'),
      runSpxOosValidationAsOf(from, to, '30d'),
    ]);
    
    const delta = {
      equityDiffPct: standard.cascade.equityFinal !== 0 
        ? ((asOf.cascade.equityFinal - standard.cascade.equityFinal) / standard.cascade.equityFinal) * 100 
        : 0,
      maxDDDiffPct: standard.cascade.maxDrawdown !== 0 
        ? ((asOf.cascade.maxDrawdown - standard.cascade.maxDrawdown) / standard.cascade.maxDrawdown) * 100 
        : 0,
      volatilityDiffPct: standard.cascade.volatility !== 0 
        ? ((asOf.cascade.volatility - standard.cascade.volatility) / standard.cascade.volatility) * 100 
        : 0,
      hitRateDiff: asOf.cascade.hitRate - standard.cascade.hitRate,
    };
    
    return {
      ok: true,
      asset: 'SPX',
      period: { from, to },
      standard: {
        equity: standard.cascade.equityFinal,
        maxDD: standard.cascade.maxDrawdown,
        volatility: standard.cascade.volatility,
        hitRate: standard.cascade.hitRate,
      },
      asOf: {
        equity: asOf.cascade.equityFinal,
        maxDD: asOf.cascade.maxDrawdown,
        volatility: asOf.cascade.volatility,
        hitRate: asOf.cascade.hitRate,
      },
      delta,
      biasAssessment: assessBias(delta),
      durationMs: Date.now() - t0,
    };
  });
  
  /**
   * POST /api/p33/bias-check/btc
   * 
   * Run BTC bias check: standard vs as-of validation.
   */
  fastify.post(`${prefix}/bias-check/btc`, async (req: FastifyRequest): Promise<BiasCheckResult> => {
    const t0 = Date.now();
    const body = (req.body ?? {}) as { from?: string; to?: string };
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    
    console.log(`[P3.3] Running BTC bias check ${from} → ${to}`);
    
    // Run both validations
    const [standard, asOf] = await Promise.all([
      runBtcOosValidation(from, to, '30d'),
      runBtcOosValidationAsOf(from, to, '30d'),
    ]);
    
    const delta = {
      equityDiffPct: standard.cascade.equityFinal !== 0 
        ? ((asOf.cascade.equityFinal - standard.cascade.equityFinal) / standard.cascade.equityFinal) * 100 
        : 0,
      maxDDDiffPct: standard.cascade.maxDrawdown !== 0 
        ? ((asOf.cascade.maxDrawdown - standard.cascade.maxDrawdown) / standard.cascade.maxDrawdown) * 100 
        : 0,
      volatilityDiffPct: standard.cascade.volatility !== 0 
        ? ((asOf.cascade.volatility - standard.cascade.volatility) / standard.cascade.volatility) * 100 
        : 0,
      hitRateDiff: asOf.cascade.hitRate - standard.cascade.hitRate,
    };
    
    return {
      ok: true,
      asset: 'BTC',
      period: { from, to },
      standard: {
        equity: standard.cascade.equityFinal,
        maxDD: standard.cascade.maxDrawdown,
        volatility: standard.cascade.volatility,
        hitRate: standard.cascade.hitRate,
      },
      asOf: {
        equity: asOf.cascade.equityFinal,
        maxDD: asOf.cascade.maxDrawdown,
        volatility: asOf.cascade.volatility,
        hitRate: asOf.cascade.hitRate,
      },
      delta,
      biasAssessment: assessBias(delta),
      durationMs: Date.now() - t0,
    };
  });
  
  /**
   * POST /api/p33/bias-check/full
   * 
   * Run full bias check for both SPX and BTC.
   */
  fastify.post(`${prefix}/bias-check/full`, async (req: FastifyRequest) => {
    const t0 = Date.now();
    const body = (req.body ?? {}) as { from?: string; to?: string };
    const from = body.from || '2021-01-01';
    const to = body.to || '2025-12-31';
    
    console.log(`[P3.3] Running FULL bias check ${from} → ${to}`);
    
    // Run all 4 validations in parallel
    const [spxStandard, spxAsOf, btcStandard, btcAsOf] = await Promise.all([
      runSpxOosValidation(from, to, '30d'),
      runSpxOosValidationAsOf(from, to, '30d'),
      runBtcOosValidation(from, to, '30d'),
      runBtcOosValidationAsOf(from, to, '30d'),
    ]);
    
    // SPX delta
    const spxDelta = {
      equityDiffPct: spxStandard.cascade.equityFinal !== 0 
        ? ((spxAsOf.cascade.equityFinal - spxStandard.cascade.equityFinal) / spxStandard.cascade.equityFinal) * 100 
        : 0,
      maxDDDiffPct: spxStandard.cascade.maxDrawdown !== 0 
        ? ((spxAsOf.cascade.maxDrawdown - spxStandard.cascade.maxDrawdown) / spxStandard.cascade.maxDrawdown) * 100 
        : 0,
      volatilityDiffPct: spxStandard.cascade.volatility !== 0 
        ? ((spxAsOf.cascade.volatility - spxStandard.cascade.volatility) / spxStandard.cascade.volatility) * 100 
        : 0,
      hitRateDiff: spxAsOf.cascade.hitRate - spxStandard.cascade.hitRate,
    };
    
    // BTC delta
    const btcDelta = {
      equityDiffPct: btcStandard.cascade.equityFinal !== 0 
        ? ((btcAsOf.cascade.equityFinal - btcStandard.cascade.equityFinal) / btcStandard.cascade.equityFinal) * 100 
        : 0,
      maxDDDiffPct: btcStandard.cascade.maxDrawdown !== 0 
        ? ((btcAsOf.cascade.maxDrawdown - btcStandard.cascade.maxDrawdown) / btcStandard.cascade.maxDrawdown) * 100 
        : 0,
      volatilityDiffPct: btcStandard.cascade.volatility !== 0 
        ? ((btcAsOf.cascade.volatility - btcStandard.cascade.volatility) / btcStandard.cascade.volatility) * 100 
        : 0,
      hitRateDiff: btcAsOf.cascade.hitRate - btcStandard.cascade.hitRate,
    };
    
    const spxBias = assessBias(spxDelta);
    const btcBias = assessBias(btcDelta);
    
    // Overall assessment
    const overallClean = spxBias.clean && btcBias.clean;
    const overallSeverity = spxBias.severity === 'HIGH' || btcBias.severity === 'HIGH' ? 'HIGH' :
                           spxBias.severity === 'MEDIUM' || btcBias.severity === 'MEDIUM' ? 'MEDIUM' :
                           spxBias.severity === 'LOW' || btcBias.severity === 'LOW' ? 'LOW' : 'NONE';
    
    return {
      ok: true,
      period: { from, to },
      spx: {
        standard: { equity: spxStandard.cascade.equityFinal, maxDD: spxStandard.cascade.maxDrawdown },
        asOf: { equity: spxAsOf.cascade.equityFinal, maxDD: spxAsOf.cascade.maxDrawdown },
        delta: spxDelta,
        biasAssessment: spxBias,
      },
      btc: {
        standard: { equity: btcStandard.cascade.equityFinal, maxDD: btcStandard.cascade.maxDrawdown },
        asOf: { equity: btcAsOf.cascade.equityFinal, maxDD: btcAsOf.cascade.maxDrawdown },
        delta: btcDelta,
        biasAssessment: btcBias,
      },
      overall: {
        clean: overallClean,
        severity: overallSeverity,
        recommendation: overallClean 
          ? 'System architecture is clean. Safe to proceed to P4.' 
          : 'Lookahead bias detected. Review rolling window calculations before P4.',
      },
      durationMs: Date.now() - t0,
    };
  });
  
  fastify.log.info('[P3.3] Bias check routes registered at /api/p33/*');
}

export default registerP33BiasCheckRoutes;
