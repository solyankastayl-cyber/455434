/**
 * ENGINE GLOBAL + BRAIN BRIDGE — P7.0 + P10.3
 * 
 * Integration layer between EngineGlobal and Brain v2.
 * Supports three modes:
 * - off: Return base engine output (no brain)
 * - shadow: Return base output + what brain WOULD do
 * - on: Apply brain overrides + MetaRisk to allocations
 * 
 * P10.3: Adds MetaRisk shrink logic and globalScale application
 */

import { buildEngineGlobal } from './engine_global.service.js';
import { getBrainOrchestratorService } from '../brain/services/brain_orchestrator.service.js';
import { getBrainOverrideApplyService } from '../brain/services/brain_override_apply.service.js';
import { getMetaRiskService } from '../brain/services/meta_risk.service.js';
import { getOptimizerService } from '../brain/optimizer/optimizer.service.js';
import { getRegimeMemoryService } from '../brain/services/regime_memory.service.js';
import { getAdaptiveService } from '../brain/adaptive/adaptive.service.js';
import { applyBrainBridge, validateBridgeOutput } from './brain_bridge.service.js';
import type { EngineGlobalResponse, EngineAllocation } from './engine_global.contract.js';
import type { BrainOutputPack } from '../brain/contracts/brain_output.contract.js';
import type { OptimizerOutput, OptimizerInput } from '../brain/optimizer/optimizer.contract.js';
import type { AdaptiveMode } from '../brain/adaptive/adaptive.contract.js';
import { 
  getCapitalScalingService, 
  type CapitalScalingMode,
  type CapitalScalingPack,
  type CapitalScalingInput
} from '../capital-scaling/index.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type BrainMode = 'on' | 'off' | 'shadow';

export interface BrainWouldApply {
  spxDelta: number;
  btcDelta: number;
  dxyDelta: number;
  cashDelta: number;
  reasons: string[];
}

export interface MetaRiskSection {
  posture: string;
  globalScale: number;
  maxOverrideCap: number;
  intensityBefore: number;
  intensityAfter: number;
  shrinkApplied: boolean;
  shrinkFactor?: number;
  tailRiskClamp: boolean;
}

export interface OverrideIntensitySection {
  brain: number;           // Intensity from Brain directives (caps/haircuts/scales)
  metaRiskScale: number;   // Intensity from MetaRisk globalScale
  optimizer: number;       // Intensity from Optimizer deltas
  total: number;           // Total intensity (base → final)
  cap: number;             // Current cap (0.35 BASE/RISK, 0.60 TAIL)
  withinCap: boolean;
}

export interface AdaptiveSection {
  mode: AdaptiveMode;
  versionId: string;
  asset: string;
  source: string;
  deltasApplied: {
    brain: { tailQ05: number; spread: number; bullMean: number };
    optimizer: { K: number; wReturn: number; wTail: number; wCorr: number; wGuard: number };
    metarisk: { durationScale: number; stabilityScale: number; flipPenalty: number; crossAdj: number };
  };
}

export interface BrainSection {
  mode: BrainMode;
  decision?: BrainOutputPack;
  wouldApply?: BrainWouldApply;
  metaRisk?: MetaRiskSection;
  overrideIntensity?: OverrideIntensitySection;  // P12: Split intensity
  adaptive?: AdaptiveSection;  // P12: Adaptive params info
  bridgeSteps?: any[];
  warnings?: string[];
  optimizer?: OptimizerOutput;
  capitalScaling?: CapitalScalingPack; // v2.3: Capital Scaling pack
}

export interface EngineGlobalWithBrainResponse extends EngineGlobalResponse {
  brain: BrainSection;
}

// ═══════════════════════════════════════════════════════════════
// MAIN BRIDGE FUNCTION (P10.3 Enhanced)
// ═══════════════════════════════════════════════════════════════

export async function getEngineGlobalWithBrain(params: {
  asOf?: string;
  brain?: boolean;
  brainMode?: BrainMode;
  optimizer?: boolean;  // P11: Enable optimizer wrapper
  capital?: boolean;    // v2.3: Enable capital scaling
  capitalMode?: CapitalScalingMode; // v2.3: Capital scaling mode
}): Promise<EngineGlobalWithBrainResponse> {
  const { asOf, brain = false, brainMode = 'off', optimizer = false, capital = false, capitalMode = 'shadow' } = params;
  const effectiveAsOf = asOf || new Date().toISOString().split('T')[0];
  
  // 1. Get base engine output
  const engineOut = await buildEngineGlobal(asOf);
  
  // 2. If brain disabled, return base with brain.mode = 'off'
  if (!brain || brainMode === 'off') {
    return {
      ...engineOut,
      brain: { mode: 'off' },
    };
  }
  
  // 3. Get brain decision
  const brainService = getBrainOrchestratorService();
  const brainDecision = await brainService.computeDecision(effectiveAsOf);
  
  // 4. Get MetaRisk (P10.3) - pass brain scenario to avoid circular call
  let metaRiskPack;
  try {
    // Extract brain scenario for MetaRisk
    const brainScenario = brainDecision?.scenario ? {
      scenario: brainDecision.scenario.name,
      pTail: brainDecision.scenario.probabilities?.pTail || 0,
      pRisk: brainDecision.scenario.probabilities?.pRisk || 0,
    } : undefined;
    
    metaRiskPack = await getMetaRiskService().getMetaRisk(effectiveAsOf, brainScenario);
  } catch (e) {
    console.warn('[EngineBrain] MetaRisk unavailable:', (e as Error).message);
  }
  
  // 5. Shadow mode: return base allocations + what brain would do
  if (brainMode === 'shadow') {
    // Use old method for shadow comparison
    const engineAllocationsForBrain = {
      allocations: {
        spx: { size: engineOut.allocations.spxSize, direction: 'LONG' },
        btc: { size: engineOut.allocations.btcSize, direction: 'LONG' },
        dxy: { size: engineOut.allocations.dxySize, direction: 'LONG' },
      },
      cash: engineOut.allocations.cashSize,
    };
    
    const applyService = getBrainOverrideApplyService();
    const applied = applyService.applyOverrides(engineAllocationsForBrain, brainDecision);
    const wouldApply = computeDiff(engineOut.allocations, applied);
    
    return {
      ...engineOut,
      brain: {
        mode: 'shadow',
        decision: brainDecision,
        wouldApply,
        metaRisk: metaRiskPack ? {
          posture: metaRiskPack.posture,
          globalScale: metaRiskPack.metaRiskScale,
          maxOverrideCap: metaRiskPack.maxOverrideCap,
          intensityBefore: 0,
          intensityAfter: 0,
          shrinkApplied: false,
          tailRiskClamp: false,
        } : undefined,
      },
    };
  }
  
  // 6. ON MODE: Apply brain overrides + MetaRisk shrink (P10.3)
  
  // First apply basic brain overrides to get "after brain" allocations
  const engineAllocationsForBrain = {
    allocations: {
      spx: { size: engineOut.allocations.spxSize, direction: 'LONG' },
      btc: { size: engineOut.allocations.btcSize, direction: 'LONG' },
      dxy: { size: engineOut.allocations.dxySize, direction: 'LONG' },
    },
    cash: engineOut.allocations.cashSize,
  };
  
  const applyService = getBrainOverrideApplyService();
  const brainApplied = applyService.applyOverrides(engineAllocationsForBrain, brainDecision);
  
  // Convert to intermediate allocations
  const afterBrainAllocations: EngineAllocation = {
    spxSize: brainApplied.allocations?.spx?.size ?? engineOut.allocations.spxSize,
    btcSize: brainApplied.allocations?.btc?.size ?? engineOut.allocations.btcSize,
    dxySize: brainApplied.allocations?.dxy?.size ?? engineOut.allocations.dxySize,
    cashSize: brainApplied.cash ?? engineOut.allocations.cashSize,
  };
  
  // Apply Brain Bridge with MetaRisk (P10.3 shrink + scale)
  const bridgeResult = applyBrainBridge({
    baseAllocations: engineOut.allocations,
    brainOutput: brainDecision,
    metaRisk: metaRiskPack,
    minCash: 0.05,
  });
  
  // Validate bridge output
  const validation = validateBridgeOutput(bridgeResult);
  if (!validation.valid) {
    console.error('[EngineBrain] Bridge validation failed:', validation.errors);
    bridgeResult.warnings.push(...validation.errors.map(e => `VALIDATION: ${e}`));
  }
  
  // ─────────────────────────────────────────────────────────────
  // P11: Apply Optimizer (small deltas on top of Brain)
  // ─────────────────────────────────────────────────────────────
  
  let finalAllocations = bridgeResult.allocations;
  let optimizerResult: OptimizerOutput | undefined;
  
  if (optimizer) {
    try {
      // Build optimizer input
      const regimeMemory = await getRegimeMemoryService().getCurrent(effectiveAsOf);
      const crossAssetRegime = regimeMemory.crossAsset.current;
      
      // Estimate contagion score
      let contagionScore = 0.3;
      if (crossAssetRegime === 'RISK_OFF_SYNC') contagionScore = 0.8;
      else if (crossAssetRegime === 'FLIGHT_TO_QUALITY') contagionScore = 0.7;
      else if (crossAssetRegime === 'DECOUPLED') contagionScore = 0.2;
      else if (crossAssetRegime === 'RISK_ON_SYNC') contagionScore = 0.4;
      
      const optimizerInput: OptimizerInput = {
        asOf: effectiveAsOf,
        allocations: {
          spx: bridgeResult.allocations.spxSize,
          btc: bridgeResult.allocations.btcSize,
          cash: bridgeResult.allocations.cashSize,
        },
        posture: metaRiskPack?.posture || 'NEUTRAL',
        scenario: (brainDecision.scenario.name as 'BASE' | 'RISK' | 'TAIL') || 'BASE',
        crossAssetRegime,
        contagionScore,
        forecasts: {
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
        },
      };
      
      optimizerResult = getOptimizerService().compute(optimizerInput, 'on');
      
      // Update final allocations with optimizer deltas
      finalAllocations = {
        spxSize: optimizerResult.final.spx,
        btcSize: optimizerResult.final.btc,
        dxySize: bridgeResult.allocations.dxySize,
        cashSize: optimizerResult.final.cash,
      };
      
      console.log(`[EngineBrain] Optimizer applied: deltas spx=${optimizerResult.deltas.spx}, btc=${optimizerResult.deltas.btc}`);
    } catch (e) {
      console.warn('[EngineBrain] Optimizer error:', (e as Error).message);
      bridgeResult.warnings.push(`OPTIMIZER_ERROR: ${(e as Error).message}`);
    }
  }
  
  // ─────────────────────────────────────────────────────────────
  // Calculate split override intensity (P12 fix - corrected)
  // 
  // Three components:
  //   1. brainDirectives: delta from Brain caps/haircuts/scales ONLY
  //   2. metaRiskScale: delta from globalScale application
  //   3. optimizer: delta from Optimizer adjustments
  //   
  // Total = sum of all three (measured vs BASE allocations)
  // ─────────────────────────────────────────────────────────────
  
  // Get base allocations (step 0) for reference
  const baseStep = bridgeResult.steps.find(s => s.step === '0_base');
  const baseSpx = baseStep?.spx ?? engineOut.allocations.spxSize;
  const baseBtc = baseStep?.btc ?? engineOut.allocations.btcSize;
  
  // Get allocations after Brain directives (step 1)
  const afterBrainStep = bridgeResult.steps.find(s => s.step === '1_brain_directives');
  const afterBrainSpx = afterBrainStep?.spx ?? baseSpx;
  const afterBrainBtc = afterBrainStep?.btc ?? baseBtc;
  
  // Get allocations after globalScale (step 4 or final from bridge)
  const afterScaleStep = bridgeResult.steps.find(s => s.step === '4_global_scale');
  const afterScaleSpx = afterScaleStep?.spx ?? afterBrainSpx;
  const afterScaleBtc = afterScaleStep?.btc ?? afterBrainBtc;
  
  // 1. Brain directives intensity (caps/haircuts/scales only)
  const brainDirectivesIntensity = Math.max(
    Math.abs(afterBrainSpx - baseSpx),
    Math.abs(afterBrainBtc - baseBtc)
  );
  
  // 2. MetaRisk globalScale intensity
  const metaRiskScaleIntensity = Math.max(
    Math.abs(afterScaleSpx - afterBrainSpx),
    Math.abs(afterScaleBtc - afterBrainBtc)
  );
  
  // 3. Optimizer intensity
  const optimizerIntensity = optimizerResult 
    ? Math.max(Math.abs(optimizerResult.deltas.spx), Math.abs(optimizerResult.deltas.btc))
    : 0;
  
  // Total intensity = delta from base to final (use actual engine baseline, not bridge steps)
  const actualBaseSpx = engineOut.allocations.spxSize;
  const actualBaseBtc = engineOut.allocations.btcSize;
  const finalSpx = finalAllocations.spxSize;
  const finalBtc = finalAllocations.btcSize;
  const totalIntensity = Math.max(
    Math.abs(finalSpx - actualBaseSpx),
    Math.abs(finalBtc - actualBaseBtc)
  );
  
  const scenario = brainDecision?.scenario?.name || 'BASE';
  const intensityCap = scenario === 'TAIL' ? 0.60 : 0.35;
  
  const overrideIntensity: OverrideIntensitySection = {
    brain: Math.round(brainDirectivesIntensity * 1000) / 1000,
    metaRiskScale: Math.round(metaRiskScaleIntensity * 1000) / 1000,
    optimizer: Math.round(optimizerIntensity * 1000) / 1000,
    total: Math.round(totalIntensity * 1000) / 1000,
    cap: intensityCap,
    withinCap: totalIntensity <= intensityCap,
  };
  
  // ─────────────────────────────────────────────────────────────
  // P12: Get Adaptive params info
  // ─────────────────────────────────────────────────────────────
  
  let adaptiveSection: AdaptiveSection | undefined;
  try {
    const adaptiveParams = await getAdaptiveService().getParams('dxy');
    adaptiveSection = {
      mode: adaptiveParams.source === 'promoted' ? 'on' : (adaptiveParams.source === 'tuned' ? 'shadow' : 'off'),
      versionId: adaptiveParams.versionId,
      asset: adaptiveParams.asset,
      source: adaptiveParams.source,
      deltasApplied: {
        brain: adaptiveParams.brain,
        optimizer: {
          K: adaptiveParams.optimizer.K,
          wReturn: adaptiveParams.optimizer.wReturn,
          wTail: adaptiveParams.optimizer.wTail,
          wCorr: adaptiveParams.optimizer.wCorr,
          wGuard: adaptiveParams.optimizer.wGuard,
        },
        metarisk: adaptiveParams.metarisk,
      },
    };
  } catch (e) {
    console.warn('[EngineBrain] Adaptive params unavailable:', (e as Error).message);
  }
  
  // ─────────────────────────────────────────────────────────────
  // v2.3: Apply Capital Scaling (Risk Budget Targeting)
  // ─────────────────────────────────────────────────────────────
  
  let capitalScalingPack: CapitalScalingPack | undefined;
  
  if (capital) {
    try {
      const capitalService = getCapitalScalingService();
      
      // Get realized vol (use SPX vol as proxy, or portfolio vol in future)
      const realizedVol = await capitalService.getRealized30dVol('SPX');
      
      // Build input for capital scaling
      const capitalInput: CapitalScalingInput = {
        allocations: {
          spx: finalAllocations.spxSize,
          btc: finalAllocations.btcSize,
          cash: finalAllocations.cashSize
        },
        scenario: (brainDecision?.scenario?.name as 'BASE' | 'RISK' | 'TAIL') || 'BASE',
        guardLevel: metaRiskPack?.guardLevel || 'NORMAL',
        realizedVol,
        tailRisk: brainDecision?.evidence?.tailRisk || 0.05,
        asOf: effectiveAsOf
      };
      
      // Apply capital scaling
      const capitalResult = capitalService.apply(capitalInput, capitalMode);
      capitalScalingPack = capitalResult.pack;
      
      // If mode is 'on', update final allocations
      if (capitalMode === 'on') {
        finalAllocations = {
          spxSize: capitalResult.allocations.spx,
          btcSize: capitalResult.allocations.btc,
          dxySize: finalAllocations.dxySize,
          cashSize: capitalResult.allocations.cash
        };
        console.log(`[EngineBrain] Capital Scaling applied: scaleFactor=${capitalResult.pack.scaleFactor.toFixed(3)}`);
      } else {
        console.log(`[EngineBrain] Capital Scaling (shadow): scaleFactor=${capitalResult.pack.scaleFactor.toFixed(3)}`);
      }
    } catch (e) {
      console.warn('[EngineBrain] Capital Scaling error:', (e as Error).message);
      bridgeResult.warnings.push(`CAPITAL_SCALING_ERROR: ${(e as Error).message}`);
    }
  }
  
  // Update evidence with brain info
  const enhancedEvidence = {
    ...engineOut.evidence,
    headline: `${engineOut.evidence.headline} | Brain: ${brainDecision.scenario.name} | Posture: ${bridgeResult.metaRisk.posture}${optimizer ? ' | Opt: ON' : ''}${capital ? ` | Cap: ${capitalMode.toUpperCase()}` : ''}`,
    brainOverrides: brainApplied.brainEvidence || [],
  };
  
  return {
    ...engineOut,
    allocations: finalAllocations,
    evidence: enhancedEvidence as any,
    brain: {
      mode: 'on',
      decision: brainDecision,
      metaRisk: bridgeResult.metaRisk,
      overrideIntensity,
      adaptive: adaptiveSection,
      bridgeSteps: bridgeResult.steps,
      warnings: bridgeResult.warnings,
      optimizer: optimizerResult,
      capitalScaling: capitalScalingPack,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function computeDiff(
  base: EngineAllocation,
  applied: any
): BrainWouldApply {
  const spxApplied = applied.allocations?.spx?.size ?? base.spxSize;
  const btcApplied = applied.allocations?.btc?.size ?? base.btcSize;
  const dxyApplied = applied.allocations?.dxy?.size ?? base.dxySize;
  
  // Calculate cash from remaining
  const totalRisk = spxApplied + btcApplied + dxyApplied;
  const cashApplied = Math.max(0, 1 - totalRisk);
  
  return {
    spxDelta: Math.round((spxApplied - base.spxSize) * 1000) / 1000,
    btcDelta: Math.round((btcApplied - base.btcSize) * 1000) / 1000,
    dxyDelta: Math.round((dxyApplied - base.dxySize) * 1000) / 1000,
    cashDelta: Math.round((cashApplied - base.cashSize) * 1000) / 1000,
    reasons: applied.brainEvidence || [],
  };
}

// ═══════════════════════════════════════════════════════════════
// TESTING HELPER
// ═══════════════════════════════════════════════════════════════

export function wouldBrainChangeAllocations(
  engineOut: EngineGlobalResponse,
  brainDecision: BrainOutputPack
): boolean {
  const applyService = getBrainOverrideApplyService();
  
  const engineAllocationsForBrain = {
    allocations: {
      spx: { size: engineOut.allocations.spxSize, direction: 'LONG' },
      btc: { size: engineOut.allocations.btcSize, direction: 'LONG' },
      dxy: { size: engineOut.allocations.dxySize, direction: 'LONG' },
    },
    cash: engineOut.allocations.cashSize,
  };
  
  return applyService.wouldChangeAnything(engineAllocationsForBrain, brainDecision);
}
