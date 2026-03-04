/**
 * BTC CASCADE SERVICE — D2
 * 
 * Fetches DXY/AE/SPX data and computes cascade overlay for BTC.
 * Returns full BtcCascadePack for terminal integration.
 * 
 * Cascade chain: DXY → AE → SPX → BTC
 * 
 * KEY INVARIANTS:
 * - Read-only access to upstream services
 * - Cascade NEVER changes BTC direction
 * - Deterministic: same inputs → same outputs
 */

import type {
  BtcCascadePack,
  BtcCascadeInputs,
  BtcCoreSignal,
  GuardLevel,
} from './btc_cascade.contract.js';

import {
  getGuardInfo,
  computeMultipliers,
  generateNotes,
  BTC_GUARD_CAPS,
} from './btc_cascade.rules.js';

// ═══════════════════════════════════════════════════════════════
// VERSION
// ═══════════════════════════════════════════════════════════════

export const BTC_CASCADE_VERSION = 'BTC_CASCADE_V1.0';

// ═══════════════════════════════════════════════════════════════
// INTERNAL FETCH FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch AE Terminal data.
 * Returns guard level, transition probabilities, scenarios, novelty, regime.
 */
async function fetchAeTerminal(): Promise<{
  guardLevel: GuardLevel;
  pStress4w: number;
  bearProb: number;
  bullProb: number;
  noveltyLabel: string;
  noveltyScore: number;
  aeRegime: string;
  aeRegimeConfidence: number;
}> {
  try {
    const response = await fetch('http://127.0.0.1:8002/api/ae/terminal');
    
    if (!response.ok) {
      console.warn('[BTC Cascade] AE terminal unavailable, using defaults');
      return getDefaultAeData();
    }
    
    const data = await response.json();
    
    if (!data.ok) {
      return getDefaultAeData();
    }
    
    // Extract guard level from recommendation or state
    let guardLevel: GuardLevel = 'NONE';
    if (data.recommendation?.guard) {
      const guard = data.recommendation.guard.toUpperCase();
      if (guard === 'BLOCK') guardLevel = 'BLOCK';
      else if (guard === 'CRISIS') guardLevel = 'CRISIS';
      else if (guard === 'WARN') guardLevel = 'WARN';
    }
    
    // Check state vector for guard level
    if (data.state?.vector?.guardLevel !== undefined) {
      const gl = data.state.vector.guardLevel;
      if (gl >= 3) guardLevel = 'BLOCK';
      else if (gl >= 2) guardLevel = 'CRISIS';
      else if (gl >= 1) guardLevel = 'WARN';
    }
    
    // Extract transition probabilities
    const transition = data.transition || {};
    const riskToStress = transition.riskToStress || {};
    const pStress4w = riskToStress.p4w ?? 0.06;
    
    // Extract scenarios
    const scenarios = data.scenarios?.probs || {};
    const bearProb = scenarios.BEAR ?? 0.25;
    const bullProb = scenarios.BULL ?? 0.25;
    
    // Extract novelty
    const novelty = data.novelty || {};
    const noveltyLabel = novelty.label ?? 'NORMAL';
    const noveltyScore = novelty.score ?? 0;
    
    // Extract regime
    const regime = data.regime || {};
    const aeRegime = regime.regime ?? 'NEUTRAL_MIXED';
    const aeRegimeConfidence = regime.confidence ?? 0.5;
    
    return {
      guardLevel,
      pStress4w,
      bearProb,
      bullProb,
      noveltyLabel,
      noveltyScore,
      aeRegime,
      aeRegimeConfidence,
    };
  } catch (error) {
    console.warn('[BTC Cascade] Error fetching AE terminal:', error);
    return getDefaultAeData();
  }
}

/**
 * Fetch SPX Cascade data with timeout and retry.
 * Returns SPX adjusted size multiplier.
 */
async function fetchSpxCascade(): Promise<{ spxAdj: number }> {
  const maxRetries = 2;
  const timeoutMs = 5000;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch('http://127.0.0.1:8002/api/fractal/spx/cascade?focus=30d', {
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        if (attempt < maxRetries) continue;
        console.warn('[BTC Cascade] SPX cascade unavailable, using defaults');
        return { spxAdj: 0.8 };
      }
      
      const data = await response.json();
      
      if (!data.ok || !data.cascade) {
        return { spxAdj: 0.8 };
      }
      
      // Get SPX adjusted size multiplier
      const spxAdj = data.cascade.multipliers?.sizeMultiplier ?? 
                     data.cascade.decisionAdjusted?.sizeMultiplier ?? 
                     0.8;
      
      return { spxAdj: Math.max(0, Math.min(1, spxAdj)) };
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.warn(`[BTC Cascade] SPX cascade timeout (attempt ${attempt + 1}/${maxRetries + 1})`);
      } else {
        console.warn(`[BTC Cascade] SPX cascade error (attempt ${attempt + 1}):`, error.message);
      }
      if (attempt === maxRetries) {
        return { spxAdj: 0.8 };
      }
      // Small delay before retry
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  return { spxAdj: 0.8 };
}

/**
 * Default AE data when terminal unavailable.
 */
function getDefaultAeData() {
  return {
    guardLevel: 'NONE' as GuardLevel,
    pStress4w: 0.06,
    bearProb: 0.25,
    bullProb: 0.25,
    noveltyLabel: 'NORMAL',
    noveltyScore: 0,
    aeRegime: 'NEUTRAL_MIXED',
    aeRegimeConfidence: 0.5,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE FUNCTION
// ═══════════════════════════════════════════════════════════════

/**
 * Build full BTC Cascade Pack.
 * 
 * @param btcSignal - BTC core signal (action, size, confidence, etc.)
 * @returns BtcCascadePack with all cascade data
 */
export async function buildBtcCascadePack(
  btcSignal: BtcCoreSignal
): Promise<BtcCascadePack> {
  const t0 = Date.now();
  
  // Fetch inputs in parallel
  const [aeData, spxData] = await Promise.all([
    fetchAeTerminal(),
    fetchSpxCascade(),
  ]);
  
  // Build cascade inputs
  const inputs: BtcCascadeInputs = {
    pStress4w: aeData.pStress4w,
    bearProb: aeData.bearProb,
    bullProb: aeData.bullProb,
    noveltyLabel: aeData.noveltyLabel as 'NORMAL' | 'RARE' | 'UNSEEN',
    noveltyScore: aeData.noveltyScore,
    spxAdj: spxData.spxAdj,
    aeRegime: aeData.aeRegime,
    aeRegimeConfidence: aeData.aeRegimeConfidence,
  };
  
  // Get guard info
  const guard = getGuardInfo(aeData.guardLevel);
  
  // Compute multipliers
  const multipliers = computeMultipliers(inputs, guard.cap);
  
  // Compute adjusted decision
  const sizeAdjusted = Math.min(guard.cap, btcSignal.size * multipliers.mTotal);
  const confidenceAdjusted = btcSignal.confidence * multipliers.mTotal;
  
  const decisionAdjusted = {
    sizeBase: btcSignal.size,
    sizeAdjusted: Math.max(0, Math.min(1, sizeAdjusted)),
    confidenceBase: btcSignal.confidence,
    confidenceAdjusted: Math.max(0, Math.min(1, confidenceAdjusted)),
  };
  
  // Generate notes
  const { notes, warnings } = generateNotes(inputs, multipliers, aeData.guardLevel);
  
  const pack: BtcCascadePack = {
    version: BTC_CASCADE_VERSION,
    guard,
    inputs,
    multipliers,
    decisionAdjusted,
    notes,
    warnings,
    computedAt: new Date().toISOString(),
  };
  
  const elapsed = Date.now() - t0;
  console.log(`[BTC Cascade] Built pack in ${elapsed}ms`);
  
  return pack;
}

/**
 * Build cascade pack from raw inputs (for testing/validation).
 */
export function buildBtcCascadeFromInputs(
  inputs: BtcCascadeInputs,
  guardLevel: GuardLevel,
  btcSignal: BtcCoreSignal
): BtcCascadePack {
  const guard = getGuardInfo(guardLevel);
  const multipliers = computeMultipliers(inputs, guard.cap);
  
  const sizeAdjusted = Math.min(guard.cap, btcSignal.size * multipliers.mTotal);
  const confidenceAdjusted = btcSignal.confidence * multipliers.mTotal;
  
  const decisionAdjusted = {
    sizeBase: btcSignal.size,
    sizeAdjusted: Math.max(0, Math.min(1, sizeAdjusted)),
    confidenceBase: btcSignal.confidence,
    confidenceAdjusted: Math.max(0, Math.min(1, confidenceAdjusted)),
  };
  
  const { notes, warnings } = generateNotes(inputs, multipliers, guardLevel);
  
  return {
    version: BTC_CASCADE_VERSION,
    guard,
    inputs,
    multipliers,
    decisionAdjusted,
    notes,
    warnings,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Debug endpoint data.
 */
export async function getBtcCascadeDebug(): Promise<{
  version: string;
  guardCaps: typeof BTC_GUARD_CAPS;
  rawAeData: any;
  rawSpxData: any;
  timing: { ae: number; spx: number; total: number };
}> {
  const t0 = Date.now();
  
  const t1 = Date.now();
  const aeData = await fetchAeTerminal();
  const aeTime = Date.now() - t1;
  
  const t2 = Date.now();
  const spxData = await fetchSpxCascade();
  const spxTime = Date.now() - t2;
  
  return {
    version: BTC_CASCADE_VERSION,
    guardCaps: BTC_GUARD_CAPS,
    rawAeData: aeData,
    rawSpxData: spxData,
    timing: {
      ae: aeTime,
      spx: spxTime,
      total: Date.now() - t0,
    },
  };
}
