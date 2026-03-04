/**
 * BTC CASCADE RULES — D2 + P2.4.4 Liquidity
 * 
 * Pure functions for BTC cascade logic.
 * All calculations are deterministic.
 * 
 * KEY INVARIANTS:
 * - Cascade NEVER changes BTC direction
 * - Only scales size and confidence
 * - Guard always applied last
 * - BTC has tighter caps than SPX (more volatile)
 * 
 * P2.4.4: Added liquidity regime multiplier (stronger effect than SPX)
 */

import type {
  GuardLevel,
  BtcGuardInfo,
  BtcCascadeInputs,
  BtcCascadeMultipliers,
} from './btc_cascade.contract.js';

// P2.4.4: Import liquidity multiplier
import { getBtcLiquidityMultiplier } from '../liquidity-engine/liquidity.regime.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS — BTC-specific (tighter than SPX)
// ═══════════════════════════════════════════════════════════════

/** Guard caps by level (BTC more volatile → tighter caps) */
export const BTC_GUARD_CAPS: Record<GuardLevel, number> = {
  NONE: 1.00,
  WARN: 0.70,
  CRISIS: 0.35,
  BLOCK: 0.00,
};

/** Stress multiplier weight (BTC amplifies tail risk) */
export const STRESS_WEIGHT = 1.5;

/** Scenario thresholds */
export const SCENARIO_BEAR_THRESHOLD = 0.40;
export const SCENARIO_BULL_THRESHOLD = 0.40;
export const SCENARIO_BEAR_MULT = 0.80;
export const SCENARIO_BULL_MULT = 1.05;

/** Novelty haircut */
export const NOVELTY_RARE_MULT = 0.85;

/** SPX coupling thresholds */
export const SPX_LOW_THRESHOLD = 0.40;
export const SPX_HIGH_THRESHOLD = 0.80;
export const SPX_LOW_MULT = 0.75;
export const SPX_HIGH_MULT = 1.05;

// ═══════════════════════════════════════════════════════════════
// GUARD LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Get guard info from level.
 */
export function getGuardInfo(level: GuardLevel): BtcGuardInfo {
  return {
    level,
    cap: BTC_GUARD_CAPS[level],
  };
}

// ═══════════════════════════════════════════════════════════════
// MULTIPLIER CALCULATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate stress multiplier.
 * 
 * mStress = clamp(1 - 1.5 * pStress4w, 0.10, 1.00)
 * BTC amplifies tail risk more than SPX.
 */
export function calcStressMultiplier(pStress4w: number): number {
  const stress = Math.max(0, Math.min(0.5, pStress4w));
  const m = 1 - STRESS_WEIGHT * stress;
  return Math.max(0.10, Math.min(1.00, m));
}

/**
 * Calculate scenario multiplier.
 * 
 * bear >= 0.40 → 0.80
 * bull >= 0.40 → 1.05
 * else → 1.00
 */
export function calcScenarioMultiplier(bearProb: number, bullProb: number): number {
  if (bearProb >= SCENARIO_BEAR_THRESHOLD) {
    return SCENARIO_BEAR_MULT;
  }
  if (bullProb >= SCENARIO_BULL_THRESHOLD) {
    return SCENARIO_BULL_MULT;
  }
  return 1.00;
}

/**
 * Calculate novelty multiplier.
 * 
 * RARE/UNSEEN → 0.85
 * else → 1.00
 */
export function calcNoveltyMultiplier(label: string): number {
  const upperLabel = label.toUpperCase();
  if (upperLabel === 'RARE' || upperLabel === 'UNSEEN') {
    return NOVELTY_RARE_MULT;
  }
  return 1.00;
}

/**
 * Calculate SPX coupling multiplier.
 * 
 * Uses SPX adjusted exposure as risk-on proxy.
 * spxAdj < 0.40 → 0.75 (SPX risk-off → reduce BTC)
 * spxAdj > 0.80 → 1.05 (SPX risk-on → boost BTC)
 * else → 1.00
 */
export function calcSpxCouplingMultiplier(spxAdj: number): number {
  const adj = Math.max(0, Math.min(1, spxAdj));
  
  if (adj < SPX_LOW_THRESHOLD) {
    return SPX_LOW_MULT;
  }
  if (adj > SPX_HIGH_THRESHOLD) {
    return SPX_HIGH_MULT;
  }
  return 1.00;
}

// ═══════════════════════════════════════════════════════════════
// P2.4.4: LIQUIDITY MULTIPLIER (BTC-specific, stronger than SPX)
// ═══════════════════════════════════════════════════════════════

/**
 * P2.4.4: BTC liquidity multipliers.
 * BTC is more sensitive to liquidity than SPX.
 */
export const LIQUIDITY_MULTIPLIERS_BTC = {
  EXPANSION: 1.20,    // +20% boost
  NEUTRAL: 1.00,
  CONTRACTION: 0.75,  // -25% reduction
} as const;

// Cached BTC liquidity multiplier
let cachedBtcLiquidityMultiplier = { value: 1.0, regime: 'NEUTRAL', updatedAt: 0 };

/**
 * Refresh BTC liquidity multiplier cache (async).
 */
export async function refreshBtcLiquidityCache(): Promise<void> {
  try {
    const result = await getBtcLiquidityMultiplier();
    cachedBtcLiquidityMultiplier = {
      value: result.multiplier,
      regime: result.regime,
      updatedAt: Date.now(),
    };
  } catch (e) {
    console.warn('[BTC Cascade] Liquidity multiplier unavailable:', (e as Error).message);
  }
}

/**
 * Calculate BTC liquidity multiplier (sync, uses cache).
 */
export function calcLiquidityMultiplier(): { value: number; regime: string } {
  // Refresh cache in background if stale (>5 min)
  if (Date.now() - cachedBtcLiquidityMultiplier.updatedAt > 5 * 60 * 1000) {
    refreshBtcLiquidityCache().catch(() => {});
  }
  
  return { value: cachedBtcLiquidityMultiplier.value, regime: cachedBtcLiquidityMultiplier.regime };
}

// ═══════════════════════════════════════════════════════════════
// MAIN MULTIPLIER COMPUTATION — P2.4.4 Updated
// ═══════════════════════════════════════════════════════════════

/**
 * Compute all multipliers from cascade inputs.
 * P2.4.4: Added mLiquidity factor
 */
export function computeMultipliers(
  inputs: BtcCascadeInputs,
  guardCap: number
): BtcCascadeMultipliers {
  const mStress = calcStressMultiplier(inputs.pStress4w);
  const mScenario = calcScenarioMultiplier(inputs.bearProb, inputs.bullProb);
  const mNovel = calcNoveltyMultiplier(inputs.noveltyLabel);
  const mSPX = calcSpxCouplingMultiplier(inputs.spxAdj);
  
  // P2.4.4: Liquidity multiplier
  const liquidityInfo = calcLiquidityMultiplier();
  const mLiquidity = liquidityInfo.value;
  
  // Raw total (before guard cap) — includes liquidity
  const mTotalRaw = mStress * mScenario * mNovel * mSPX * mLiquidity;
  
  // Final total (after guard cap)
  const mTotal = Math.min(guardCap, mTotalRaw);
  
  return {
    mStress,
    mScenario,
    mNovel,
    mSPX,
    mLiquidity,  // P2.4.4
    mTotalRaw,
    mTotal,
  };
}

// ═══════════════════════════════════════════════════════════════
// NOTES GENERATION — P2.4.4 Updated
// ═══════════════════════════════════════════════════════════════

/**
 * Generate human-readable notes explaining the cascade.
 * P2.4.4: Added liquidity notes
 */
export function generateNotes(
  inputs: BtcCascadeInputs,
  multipliers: BtcCascadeMultipliers,
  guardLevel: GuardLevel
): { notes: string[]; warnings: string[] } {
  const notes: string[] = [];
  const warnings: string[] = [];
  
  // Guard warnings (highest priority)
  if (guardLevel === 'BLOCK') {
    warnings.push('BLOCK guard active - BTC exposure blocked');
  } else if (guardLevel === 'CRISIS') {
    warnings.push('CRISIS guard - BTC capped at 35%');
  } else if (guardLevel === 'WARN') {
    warnings.push('WARN guard - BTC capped at 70%');
  }
  
  // Stress notes
  if (inputs.pStress4w > 0.10) {
    notes.push(`High stress risk (${(inputs.pStress4w * 100).toFixed(1)}%) → mStress=${multipliers.mStress.toFixed(2)}`);
  } else if (inputs.pStress4w > 0.05) {
    notes.push(`Moderate stress risk (${(inputs.pStress4w * 100).toFixed(1)}%)`);
  }
  
  // Scenario notes
  if (inputs.bearProb >= SCENARIO_BEAR_THRESHOLD) {
    notes.push(`Bear scenario dominant (${(inputs.bearProb * 100).toFixed(0)}%) → reduced exposure`);
  } else if (inputs.bullProb >= SCENARIO_BULL_THRESHOLD) {
    notes.push(`Bull scenario dominant (${(inputs.bullProb * 100).toFixed(0)}%) → increased exposure`);
  }
  
  // Novelty notes
  if (inputs.noveltyLabel === 'RARE' || inputs.noveltyLabel === 'UNSEEN') {
    notes.push(`${inputs.noveltyLabel} market configuration → confidence haircut`);
  }
  
  // SPX coupling notes
  if (inputs.spxAdj < SPX_LOW_THRESHOLD) {
    notes.push(`SPX risk-off (adj=${(inputs.spxAdj * 100).toFixed(0)}%) → BTC reduced`);
  } else if (inputs.spxAdj > SPX_HIGH_THRESHOLD) {
    notes.push(`SPX risk-on (adj=${(inputs.spxAdj * 100).toFixed(0)}%) → BTC boosted`);
  }
  
  // P2.4.4: Liquidity notes
  const liquidityInfo = calcLiquidityMultiplier();
  if (liquidityInfo.regime === 'CONTRACTION') {
    notes.push(`Fed Liquidity CONTRACTION → BTC reduced (×${multipliers.mLiquidity.toFixed(2)})`);
  } else if (liquidityInfo.regime === 'EXPANSION') {
    notes.push(`Fed Liquidity EXPANSION → BTC boosted (×${multipliers.mLiquidity.toFixed(2)})`);
  }
  
  // Regime note
  if (inputs.aeRegime.toUpperCase().includes('STRESS')) {
    notes.push(`AE regime: ${inputs.aeRegime}`);
  }
  
  // Summary note
  if (notes.length === 0 && warnings.length === 0) {
    notes.push('Normal conditions - standard BTC exposure');
  }
  
  return { notes, warnings };
}
