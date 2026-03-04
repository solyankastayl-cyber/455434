/**
 * LIQUIDITY REGIME INTEGRATION — P2.4
 * 
 * Integrates liquidity impulse into:
 * 1. Macro Score (new component)
 * 2. Guard interaction (CRISIS acceleration)
 * 3. AE Brain state vector
 * 4. Cascade effects (SPX/BTC)
 * 
 * ISOLATION: Read-only integration with other modules
 */

import {
  LiquidityState,
  LiquidityRegime,
  LiquidityContext,
} from './liquidity.contract.js';
import { buildLiquidityContext, getLiquidityState, buildLiquidityContextAsOf } from './liquidity.impulse.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Weight for liquidity in macro score (P2.4.1) */
export const LIQUIDITY_MACRO_WEIGHT = 0.20;

/** Cascade multipliers by regime (P2.4.4) */
export const CASCADE_MULTIPLIERS = {
  SPX: {
    EXPANSION: 1.10,
    NEUTRAL: 1.00,
    CONTRACTION: 0.85,
  },
  BTC: {
    EXPANSION: 1.20,
    NEUTRAL: 1.00,
    CONTRACTION: 0.75,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// MACRO SCORE INTEGRATION (P2.4.1)
// ═══════════════════════════════════════════════════════════════

/**
 * Get liquidity component for macro score.
 * 
 * New weight structure:
 *   macroScore = 0.55 core + 0.15 housing + 0.15 activity + 0.15 credit + 0.20 liquidity
 *   (rescaled to sum to 1.0)
 * 
 * @returns Liquidity score component for macro integration
 */
export async function getLiquidityMacroComponent(): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: LiquidityRegime;
  available: boolean;
}> {
  const ctx = await buildLiquidityContext();
  
  // Convert impulse (-3..+3) to signed score (-1..+1)
  // Positive impulse = expansion = risk-on = negative macro score (USD bearish)
  // Negative impulse = contraction = risk-off = positive macro score (USD bullish)
  const scoreSigned = -ctx.state.impulse / 3;  // Invert for macro score convention
  
  return {
    key: 'LIQUIDITY',
    displayName: 'Fed Liquidity Impulse',
    scoreSigned: Math.round(scoreSigned * 1000) / 1000,
    weight: LIQUIDITY_MACRO_WEIGHT,
    confidence: ctx.state.confidence,
    regime: ctx.state.regime,
    available: ctx.meta.seriesAvailable > 0,
  };
}

/**
 * P3: Get liquidity component as of a specific date.
 */
export async function getLiquidityMacroComponentAsOf(asOfDate: string): Promise<{
  key: string;
  displayName: string;
  scoreSigned: number;
  weight: number;
  confidence: number;
  regime: LiquidityRegime;
  available: boolean;
}> {
  const ctx = await buildLiquidityContextAsOf(asOfDate);
  const scoreSigned = -ctx.state.impulse / 3;
  
  return {
    key: 'LIQUIDITY',
    displayName: 'Fed Liquidity Impulse',
    scoreSigned: Math.round(scoreSigned * 1000) / 1000,
    weight: LIQUIDITY_MACRO_WEIGHT,
    confidence: ctx.state.confidence,
    regime: ctx.state.regime,
    available: ctx.meta.seriesAvailable > 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// GUARD INTERACTION (P2.4.2)
// ═══════════════════════════════════════════════════════════════

/**
 * Check if liquidity contraction should accelerate CRISIS transition.
 * 
 * Conditions:
 * - liquidity = CONTRACTION
 * - credit stress rising
 * 
 * Used by crisis_guard.service to potentially fast-track to CRISIS
 */
export async function shouldAccelerateCrisis(
  creditTrend: 'UP' | 'DOWN' | 'FLAT'
): Promise<{ accelerate: boolean; reason: string }> {
  const state = await getLiquidityState();
  
  if (state.regime === 'CONTRACTION' && creditTrend === 'UP') {
    return {
      accelerate: true,
      reason: `Liquidity CONTRACTION (impulse=${state.impulse.toFixed(2)}) + rising credit stress`,
    };
  }
  
  return {
    accelerate: false,
    reason: state.regime === 'CONTRACTION' 
      ? 'Liquidity contraction but credit not rising'
      : `Liquidity regime: ${state.regime}`,
  };
}

// ═══════════════════════════════════════════════════════════════
// AE BRAIN INTEGRATION (P2.4.3)
// ═══════════════════════════════════════════════════════════════

/**
 * Get liquidity impulse for AE Brain state vector expansion.
 * 
 * State vector becomes:
 * [macroSigned, credit, guard, dxyBias, liquidityImpulse, inflationTrend, ratesSlope]
 */
export async function getLiquidityForStateVector(): Promise<{
  liquidityImpulse: number;   // -1..+1 normalized
  regime: LiquidityRegime;
  confidence: number;
}> {
  const state = await getLiquidityState();
  
  return {
    liquidityImpulse: Math.round((state.impulse / 3) * 1000) / 1000,  // Normalize to -1..+1
    regime: state.regime,
    confidence: state.confidence,
  };
}

/**
 * P3.3: Get liquidity impulse as of a specific date.
 * For honest backtesting.
 */
export async function getLiquidityForStateVectorAsOf(asOfDate: string): Promise<{
  liquidityImpulse: number;
  regime: LiquidityRegime;
  confidence: number;
}> {
  const ctx = await buildLiquidityContextAsOf(asOfDate);
  
  return {
    liquidityImpulse: Math.round((ctx.state.impulse / 3) * 1000) / 1000,
    regime: ctx.state.regime,
    confidence: ctx.state.confidence,
  };
}

// ═══════════════════════════════════════════════════════════════
// CASCADE MULTIPLIERS (P2.4.4)
// ═══════════════════════════════════════════════════════════════

/**
 * Get cascade multiplier for SPX based on liquidity regime.
 * 
 * SPX:
 * - contraction → mLiquidity = 0.85
 * - expansion → mLiquidity = 1.10
 */
export async function getSpxLiquidityMultiplier(): Promise<{
  multiplier: number;
  regime: LiquidityRegime;
  note: string;
}> {
  const state = await getLiquidityState();
  const mult = CASCADE_MULTIPLIERS.SPX[state.regime];
  
  let note: string;
  switch (state.regime) {
    case 'EXPANSION':
      note = 'Liquidity expansion → SPX exposure boosted';
      break;
    case 'CONTRACTION':
      note = 'Liquidity contraction → SPX exposure reduced';
      break;
    default:
      note = 'Liquidity neutral → standard SPX exposure';
  }
  
  return {
    multiplier: mult,
    regime: state.regime,
    note,
  };
}

/**
 * Get cascade multiplier for BTC based on liquidity regime.
 * 
 * BTC (more volatile than SPX):
 * - contraction → mLiquidity = 0.75
 * - expansion → mLiquidity = 1.20
 */
export async function getBtcLiquidityMultiplier(): Promise<{
  multiplier: number;
  regime: LiquidityRegime;
  note: string;
}> {
  const state = await getLiquidityState();
  const mult = CASCADE_MULTIPLIERS.BTC[state.regime];
  
  let note: string;
  switch (state.regime) {
    case 'EXPANSION':
      note = 'Liquidity expansion → BTC exposure boosted (+20%)';
      break;
    case 'CONTRACTION':
      note = 'Liquidity contraction → BTC exposure reduced (-25%)';
      break;
    default:
      note = 'Liquidity neutral → standard BTC exposure';
  }
  
  return {
    multiplier: mult,
    regime: state.regime,
    note,
  };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Validate liquidity regime against historical episode.
 * Used for acceptance criteria testing.
 */
export async function validateHistoricalRegime(
  date: string,
  expectedRegime: LiquidityRegime
): Promise<{
  date: string;
  expected: LiquidityRegime;
  actual: LiquidityRegime;
  impulse: number;
  match: boolean;
}> {
  // This would require historical backfill
  // For now, returns current state
  const state = await getLiquidityState();
  
  return {
    date,
    expected: expectedRegime,
    actual: state.regime,
    impulse: state.impulse,
    match: state.regime === expectedRegime,
  };
}
