/**
 * C1 — State Vector Aggregator Service
 * Builds normalized state vector from DXY terminal + macro + guard
 * P2.4.3: Added liquidityImpulse axis
 */

import type { AeStateVector } from '../contracts/ae_state.contract.js';
import { GUARD_LEVEL_MAP, ACTION_SIGN_MAP } from '../contracts/ae_state.contract.js';
import { clamp, safeNumber } from '../utils/ae_math.js';

// Import from dxy-macro-core (read-only)
import { computeMacroScore, computeMacroScoreAsOf } from '../../dxy-macro-core/services/macro_score.service.js';
import { computeCrisisGuard, computeCrisisGuardAsOf } from '../../dxy-macro-core/services/crisis_guard.service.js';

// Import from dxy terminal (read-only)
import { buildDxyTerminalPack } from '../../dxy/services/dxy_terminal.service.js';

// P2.4.3: Import from liquidity-engine
import { getLiquidityForStateVector, getLiquidityForStateVectorAsOf } from '../../liquidity-engine/liquidity.regime.js';

/**
 * Build AE State Vector
 * Aggregates macro, guard, DXY terminal, and liquidity into normalized vector
 */
export async function buildAeState(asOf?: string): Promise<AeStateVector> {
  const missing: string[] = [];
  const today = asOf || new Date().toISOString().split('T')[0];
  
  // Default vector (neutral)
  const vector = {
    macroSigned: 0,
    macroConfidence: 0.5,
    guardLevel: 0,
    dxySignalSigned: 0,
    dxyConfidence: 0.5,
    regimeBias90d: 0,
    liquidityImpulse: 0,  // P2.4.3
  };
  
  // P2.4.3: Liquidity details
  let liquidityDetails: AeStateVector['liquidity'] = undefined;
  
  // 1. Get Macro Score
  try {
    const macroScore = await computeMacroScore();
    console.log('[AE State] Macro score:', macroScore?.scoreSigned);
    if (macroScore && macroScore.scoreSigned !== undefined) {
      vector.macroSigned = clamp(safeNumber(macroScore.scoreSigned), -1, 1);
      
      // confidence может быть строкой (LOW/MEDIUM/HIGH) или числом
      const confValue = macroScore.confidence;
      if (typeof confValue === 'string') {
        // Map string to numeric
        const confMap: Record<string, number> = { 'LOW': 0.3, 'MEDIUM': 0.6, 'HIGH': 0.9 };
        vector.macroConfidence = confMap[confValue] ?? 0.5;
      } else {
        vector.macroConfidence = clamp(safeNumber(confValue, 0.5), 0, 1);
      }
    } else {
      missing.push('macro_score');
    }
  } catch (e) {
    console.warn('[AE State] Macro score unavailable:', (e as Error).message);
    missing.push('macro_score');
  }
  
  // 2. Get Crisis Guard
  try {
    const guardResult = await computeCrisisGuard(vector.macroSigned);
    if (guardResult.stress) {
      const level = guardResult.stress.level || 'NONE';
      vector.guardLevel = GUARD_LEVEL_MAP[level] ?? 0;
    }
  } catch (e) {
    console.warn('[AE State] Guard unavailable:', (e as Error).message);
    missing.push('guard');
  }
  
  // 3. Get DXY Terminal
  try {
    const dxyPack = await buildDxyTerminalPack({ focus: '30d' });
    if (dxyPack.ok && dxyPack.core && dxyPack.core.decision) {
      const decision = dxyPack.core.decision;
      
      // Action to signed signal
      const action = decision.action || 'HOLD';
      const actionSign = ACTION_SIGN_MAP[action] ?? 0;
      
      // Scale by forecast return (tanh normalization, k=0.03)
      const forecastReturn = safeNumber(decision.forecastReturn, 0);
      const returnScale = Math.tanh(Math.abs(forecastReturn) / 0.03);
      
      vector.dxySignalSigned = clamp(actionSign * returnScale, -1, 1);
      
      // Confidence
      const confidence = decision.macroAdjustedConfidence 
        || decision.confidence 
        || 0.5;
      vector.dxyConfidence = clamp(safeNumber(confidence), 0, 1);
      
      // 90d regime bias (if available in diagnostics)
      if (dxyPack.core.diagnostics && dxyPack.core.diagnostics.regimeBias !== undefined) {
        vector.regimeBias90d = clamp(safeNumber(dxyPack.core.diagnostics.regimeBias), -1, 1);
      } else if (decision.regimeBias !== undefined) {
        vector.regimeBias90d = clamp(safeNumber(decision.regimeBias), -1, 1);
      }
    } else {
      missing.push('dxy_terminal');
    }
  } catch (e) {
    console.warn('[AE State] DXY terminal unavailable:', (e as Error).message);
    missing.push('dxy_terminal');
  }
  
  // 4. P2.4.3: Get Liquidity Impulse
  try {
    const liquidity = await getLiquidityForStateVector();
    vector.liquidityImpulse = clamp(safeNumber(liquidity.liquidityImpulse), -1, 1);
    
    liquidityDetails = {
      impulse: liquidity.liquidityImpulse * 3,  // Denormalize to -3..+3
      regime: liquidity.regime,
      confidence: liquidity.confidence,
    };
    
    console.log('[AE State] Liquidity impulse:', liquidity.liquidityImpulse, 'regime:', liquidity.regime);
  } catch (e) {
    console.warn('[AE State] Liquidity unavailable:', (e as Error).message);
    missing.push('liquidity');
  }
  
  return {
    asOf: today,
    vector,
    health: {
      ok: missing.length === 0,
      missing,
    },
    liquidity: liquidityDetails,
  };
}

/**
 * P3.3: Build AE State Vector AS OF a specific date
 * Uses only data that would have been available at that date.
 * CRITICAL for honest backtesting without lookahead.
 */
export async function buildAeStateAsOf(asOf: string): Promise<AeStateVector> {
  const missing: string[] = [];
  
  // Default vector (neutral)
  const vector = {
    macroSigned: 0,
    macroConfidence: 0.5,
    guardLevel: 0,
    dxySignalSigned: 0,
    dxyConfidence: 0.5,
    regimeBias90d: 0,
    liquidityImpulse: 0,
  };
  
  let liquidityDetails: AeStateVector['liquidity'] = undefined;
  
  // 1. Get Macro Score AS-OF
  try {
    const macroScore = await computeMacroScoreAsOf(asOf);
    if (macroScore && macroScore.scoreSigned !== undefined) {
      vector.macroSigned = clamp(safeNumber(macroScore.scoreSigned), -1, 1);
      
      const confValue = macroScore.confidence;
      if (typeof confValue === 'string') {
        const confMap: Record<string, number> = { 'LOW': 0.3, 'MEDIUM': 0.6, 'HIGH': 0.9 };
        vector.macroConfidence = confMap[confValue] ?? 0.5;
      } else {
        vector.macroConfidence = clamp(safeNumber(confValue, 0.5), 0, 1);
      }
    } else {
      missing.push('macro_score');
    }
  } catch (e) {
    console.warn('[AE State AsOf] Macro score unavailable:', (e as Error).message);
    missing.push('macro_score');
  }
  
  // 2. Get Crisis Guard AS-OF
  try {
    const guardResult = await computeCrisisGuardAsOf(asOf, vector.macroSigned);
    if (guardResult.stress) {
      const level = guardResult.stress.level || 'NONE';
      vector.guardLevel = GUARD_LEVEL_MAP[level] ?? 0;
    }
  } catch (e) {
    // Fallback to synthetic guard from macro
    console.warn('[AE State AsOf] Guard unavailable, using macro fallback:', (e as Error).message);
    // Simple fallback: if macro is strongly negative, assume stress
    if (vector.macroSigned < -0.3) {
      vector.guardLevel = 1; // WARN
    }
    if (vector.macroSigned < -0.5) {
      vector.guardLevel = 2; // CRISIS
    }
    missing.push('guard');
  }
  
  // 3. Skip DXY Terminal for as-of (would need full replay)
  // Use neutral/missing
  missing.push('dxy_terminal');
  
  // 4. Get Liquidity Impulse AS-OF
  try {
    const liquidity = await getLiquidityForStateVectorAsOf(asOf);
    vector.liquidityImpulse = clamp(safeNumber(liquidity.liquidityImpulse), -1, 1);
    
    liquidityDetails = {
      impulse: liquidity.liquidityImpulse * 3,
      regime: liquidity.regime,
      confidence: liquidity.confidence,
    };
  } catch (e) {
    console.warn('[AE State AsOf] Liquidity unavailable:', (e as Error).message);
    missing.push('liquidity');
  }
  
  return {
    asOf,
    vector,
    health: {
      ok: missing.length <= 1, // Allow missing DXY terminal
      missing,
    },
    liquidity: liquidityDetails,
  };
}

/**
 * Convert state vector to array (for KNN)
 * P2.4.3: Added liquidityImpulse as 7th dimension
 */
export function stateVectorToArray(v: AeStateVector['vector']): number[] {
  return [
    v.macroSigned,
    v.macroConfidence,
    v.guardLevel,
    v.dxySignalSigned,
    v.dxyConfidence,
    v.regimeBias90d,
    v.liquidityImpulse,  // P2.4.3
  ];
}
