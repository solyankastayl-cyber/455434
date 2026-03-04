/**
 * SPX CASCADE SERVICE — D1 Extended
 * 
 * Fetches DXY/AE data and computes cascade overlay for SPX.
 * Returns full SpxCascadePack for terminal integration.
 * 
 * KEY INVARIANTS:
 * - Read-only access to DXY/AE (no modifications)
 * - Cascade NEVER changes SPX direction
 * - Deterministic: same inputs → same outputs
 */

import type {
  SpxCascadePack,
  CascadeInputs,
  CascadeDxyInputs,
  CascadeAeInputs,
  SpxCoreSignal,
} from './spx_cascade.contract.js';

import {
  computeOverlay,
  computeMultipliers,
  generateExplain,
} from './spx_cascade.rules.js';

// ═══════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════

export const SPX_CASCADE_VERSION = 'SPX_CASCADE_V1.0';

// ═══════════════════════════════════════════════════════════════
// INTERNAL FETCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch DXY terminal data.
 * Returns tactical signal, regime bias, and guard level.
 */
async function fetchDxyTerminal(): Promise<CascadeDxyInputs> {
  try {
    // Fetch from internal API
    const response = await fetch('http://127.0.0.1:8002/api/fractal/dxy?focus=30d');
    
    if (!response.ok) {
      console.warn('[SPX Cascade] DXY terminal unavailable, using defaults');
      return getDefaultDxyInputs();
    }
    
    const data = await response.json();
    
    // Extract DXY data
    const dxyData = data.data || data;
    
    // Determine tactical action from synthetic returns
    let tacticalAction: 'LONG' | 'SHORT' | 'HOLD' = 'HOLD';
    const baseReturn = dxyData.synthetic?.baseReturn ?? 0;
    if (baseReturn > 0.01) tacticalAction = 'LONG';
    else if (baseReturn < -0.01) tacticalAction = 'SHORT';
    
    // Get confidence from matches
    const topMatch = dxyData.matches?.[0];
    const tacticalConfidence01 = topMatch?.similarity ?? 0.5;
    
    // Determine guard level from meta or defaults
    // Guard comes from macro overlay if available
    let guard: 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK' = 'NONE';
    if (data.meta?.macro?.guard) {
      guard = data.meta.macro.guard;
    }
    
    // Regime bias from longer-term signal
    const regimeBiasSigned = baseReturn * 5; // Scale to [-1, 1]
    
    return {
      tacticalAction,
      tacticalConfidence01: Math.max(0, Math.min(1, tacticalConfidence01)),
      regimeMode: 'tactical',
      regimeBiasSigned: Math.max(-1, Math.min(1, regimeBiasSigned)),
      guard,
    };
  } catch (error) {
    console.warn('[SPX Cascade] Error fetching DXY terminal:', error);
    return getDefaultDxyInputs();
  }
}

/**
 * Fetch AE Brain terminal data.
 * Returns regime, transition matrix, novelty, scenarios.
 */
async function fetchAeTerminal(): Promise<CascadeAeInputs> {
  try {
    const response = await fetch('http://127.0.0.1:8002/api/ae/terminal');
    
    if (!response.ok) {
      console.warn('[SPX Cascade] AE terminal unavailable, using defaults');
      return getDefaultAeInputs();
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      return getDefaultAeInputs();
    }
    
    // Extract regime
    const regime = data.regime?.regime ?? 'NEUTRAL_MIXED';
    const regimeConfidence01 = data.regime?.confidence ?? 0.5;
    
    // Extract transition data
    const transition = data.transition || {};
    const pStress1w = transition.riskToStress?.p1w ?? 0.02;
    const pStress4w = transition.riskToStress?.p4w ?? 0.06;
    const selfTransition = transition.selfTransitionProb ?? 0.9;
    
    // Extract durations
    const durations = {
      stressMedianW: 4,
      liquidityMedianW: 24,
      currentMedianW: transition.medianDurationWeeks ?? 10,
    };
    
    // Extract novelty
    const novelty = {
      label: (data.novelty?.label ?? 'KNOWN') as 'KNOWN' | 'RARE' | 'UNKNOWN',
      score: data.novelty?.score ?? 0,
    };
    
    // Extract scenarios
    const scenarios = {
      base: data.scenarios?.probs?.BASE ?? 0.5,
      bull: data.scenarios?.probs?.BULL ?? 0.25,
      bear: data.scenarios?.probs?.BEAR ?? 0.25,
    };
    
    return {
      regime,
      regimeConfidence01,
      transition: {
        pStress1w,
        pStress4w,
        selfTransition,
      },
      durations,
      novelty,
      scenarios,
    };
  } catch (error) {
    console.warn('[SPX Cascade] Error fetching AE terminal:', error);
    return getDefaultAeInputs();
  }
}

/**
 * Default DXY inputs when terminal unavailable.
 */
function getDefaultDxyInputs(): CascadeDxyInputs {
  return {
    tacticalAction: 'HOLD',
    tacticalConfidence01: 0.5,
    regimeMode: 'tactical',
    regimeBiasSigned: 0,
    guard: 'NONE',
  };
}

/**
 * Default AE inputs when terminal unavailable.
 */
function getDefaultAeInputs(): CascadeAeInputs {
  return {
    regime: 'NEUTRAL_MIXED',
    regimeConfidence01: 0.5,
    transition: {
      pStress1w: 0.02,
      pStress4w: 0.06,
      selfTransition: 0.9,
    },
    durations: {
      stressMedianW: 4,
      liquidityMedianW: 24,
      currentMedianW: 10,
    },
    novelty: {
      label: 'KNOWN',
      score: 0,
    },
    scenarios: {
      base: 0.5,
      bull: 0.25,
      bear: 0.25,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Build full SPX Cascade Pack.
 * 
 * @param spxSignal - SPX core signal (action, confidence, etc.)
 * @returns SpxCascadePack with all cascade data
 */
export async function buildSpxCascadePack(
  spxSignal: SpxCoreSignal
): Promise<SpxCascadePack> {
  const t0 = Date.now();
  
  // Fetch inputs in parallel
  const [dxyInputs, aeInputs] = await Promise.all([
    fetchDxyTerminal(),
    fetchAeTerminal(),
  ]);
  
  const inputs: CascadeInputs = {
    dxy: dxyInputs,
    ae: aeInputs,
  };
  
  // Compute overlay
  const overlay = computeOverlay(inputs, spxSignal.action);
  
  // Compute multipliers
  const multipliers = computeMultipliers(inputs, overlay);
  
  // Compute adjusted decision
  const confidenceAdjusted = spxSignal.confidence * multipliers.confidenceMultiplier;
  const finalExposure01 = confidenceAdjusted * multipliers.sizeMultiplier;
  
  const decisionAdjusted = {
    action: spxSignal.action, // NEVER changed
    confidenceOriginal: spxSignal.confidence,
    confidenceAdjusted: Math.max(0, Math.min(1, confidenceAdjusted)),
    sizeMultiplier: multipliers.sizeMultiplier,
    finalExposure01: Math.max(0, Math.min(1, finalExposure01)),
  };
  
  // Generate explanation
  const explain = generateExplain(inputs, overlay, multipliers);
  
  const pack: SpxCascadePack = {
    version: SPX_CASCADE_VERSION,
    inputs,
    overlay,
    multipliers,
    decisionAdjusted,
    explain,
    computedAt: new Date().toISOString(),
  };
  
  const elapsed = Date.now() - t0;
  console.log(`[SPX Cascade] Built pack in ${elapsed}ms`);
  
  return pack;
}

/**
 * Build cascade pack from raw inputs (for testing/validation).
 */
export function buildCascadePackFromInputs(
  inputs: CascadeInputs,
  spxSignal: SpxCoreSignal
): SpxCascadePack {
  const overlay = computeOverlay(inputs, spxSignal.action);
  const multipliers = computeMultipliers(inputs, overlay);
  
  const confidenceAdjusted = spxSignal.confidence * multipliers.confidenceMultiplier;
  const finalExposure01 = confidenceAdjusted * multipliers.sizeMultiplier;
  
  const decisionAdjusted = {
    action: spxSignal.action,
    confidenceOriginal: spxSignal.confidence,
    confidenceAdjusted: Math.max(0, Math.min(1, confidenceAdjusted)),
    sizeMultiplier: multipliers.sizeMultiplier,
    finalExposure01: Math.max(0, Math.min(1, finalExposure01)),
  };
  
  const explain = generateExplain(inputs, overlay, multipliers);
  
  return {
    version: SPX_CASCADE_VERSION,
    inputs,
    overlay,
    multipliers,
    decisionAdjusted,
    explain,
    computedAt: new Date().toISOString(),
  };
}
