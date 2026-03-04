/**
 * C3.3 — Guards Engine
 * =====================
 * 
 * Post-matrix guards that can ONLY downgrade.
 * 
 * Guards:
 * 1. Readiness Guard - Exchange not ready → downgrade
 * 2. Whale Risk Guard - High whale risk → downgrade
 * 3. Contradiction Guard - CONTRADICTS → STRONG forbidden
 * 4. Coinbase Spot Guard - Spot divergence → confidence × 0.6
 */

import {
  FinalVerdict,
  MetaBrainV2Context,
  GuardResult,
  ValidationStatus,
} from '../contracts/metaBrainV2.types.js';
import { CoinbaseSpotContext } from '../../exchange/providers/coinbase/coinbase.spot.types.js';

// ═══════════════════════════════════════════════════════════════
// GUARD IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Readiness Guard
 * If Exchange.readiness != READY → confidence × 0.6 and STRONG → WEAK
 */
export function applyReadinessGuard(
  verdict: FinalVerdict,
  confidence: number,
  ctx: MetaBrainV2Context
): { verdict: FinalVerdict; confidence: number; result: GuardResult } {
  const triggered = ctx.exchange.readiness !== 'READY';
  
  if (!triggered) {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'readinessGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: 'Exchange readiness is READY',
      },
    };
  }
  
  const newConfidence = confidence * 0.6;
  const newVerdict = downgradeToWeak(verdict);
  
  return {
    verdict: newVerdict,
    confidence: newConfidence,
    result: {
      guardName: 'readinessGuard',
      triggered: true,
      confidenceDelta: -(confidence - newConfidence),
      verdictChange: verdict !== newVerdict ? `${verdict} → ${newVerdict}` : undefined,
      reason: `Exchange readiness is ${ctx.exchange.readiness}`,
    },
  };
}

/**
 * Whale Risk Guard
 * If whaleRisk == HIGH or whaleGuardTriggered → confidence × 0.6 and STRONG → WEAK
 */
export function applyWhaleRiskGuard(
  verdict: FinalVerdict,
  confidence: number,
  ctx: MetaBrainV2Context
): { verdict: FinalVerdict; confidence: number; result: GuardResult } {
  const highRisk = ctx.exchange.whaleRisk === 'HIGH';
  const guardTriggered = ctx.exchange.whaleGuardTriggered === true;
  const triggered = highRisk || guardTriggered;
  
  if (!triggered) {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'whaleRiskGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: `Whale risk is ${ctx.exchange.whaleRisk || 'unknown'}`,
      },
    };
  }
  
  const newConfidence = confidence * 0.6;
  const newVerdict = downgradeToWeak(verdict);
  
  return {
    verdict: newVerdict,
    confidence: newConfidence,
    result: {
      guardName: 'whaleRiskGuard',
      triggered: true,
      confidenceDelta: -(confidence - newConfidence),
      verdictChange: verdict !== newVerdict ? `${verdict} → ${newVerdict}` : undefined,
      reason: highRisk ? 'Whale risk is HIGH' : 'Whale guard was triggered',
    },
  };
}

/**
 * Contradiction Guard
 * If validation == CONTRADICTS → STRONG is ALWAYS forbidden
 */
export function applyContradictionGuard(
  verdict: FinalVerdict,
  confidence: number,
  ctx: MetaBrainV2Context
): { verdict: FinalVerdict; confidence: number; result: GuardResult } {
  const isContradicts = ctx.validation.status === 'CONTRADICTS';
  const isStrong = verdict === 'STRONG_BULLISH' || verdict === 'STRONG_BEARISH';
  const triggered = isContradicts && isStrong;
  
  if (!triggered) {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'contradictionGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: isContradicts 
          ? 'Validation contradicts but verdict is not STRONG'
          : 'Validation does not contradict',
      },
    };
  }
  
  const newVerdict = downgradeToWeak(verdict);
  
  return {
    verdict: newVerdict,
    confidence,  // Confidence not changed by this guard
    result: {
      guardName: 'contradictionGuard',
      triggered: true,
      confidenceDelta: 0,
      verdictChange: `${verdict} → ${newVerdict}`,
      reason: 'STRONG forbidden when on-chain contradicts',
    },
  };
}

/**
 * Conflict + Contradiction → INCONCLUSIVE
 */
export function applyConflictContradictionGuard(
  verdict: FinalVerdict,
  confidence: number,
  ctx: MetaBrainV2Context,
  alignment: 'ALIGNED' | 'PARTIAL' | 'CONFLICT'
): { verdict: FinalVerdict; confidence: number; result: GuardResult } {
  const isConflict = alignment === 'CONFLICT';
  const isContradicts = ctx.validation.status === 'CONTRADICTS';
  const triggered = isConflict && isContradicts;
  
  if (!triggered) {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'conflictContradictionGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: 'Not in conflict+contradict state',
      },
    };
  }
  
  return {
    verdict: 'INCONCLUSIVE',
    confidence: confidence * 0.3,
    result: {
      guardName: 'conflictContradictionGuard',
      triggered: true,
      confidenceDelta: -(confidence * 0.7),
      verdictChange: `${verdict} → INCONCLUSIVE`,
      reason: 'Conflict between S/E and on-chain contradicts - hard stop',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Downgrade STRONG to WEAK
 */
function downgradeToWeak(verdict: FinalVerdict): FinalVerdict {
  if (verdict === 'STRONG_BULLISH') return 'WEAK_BULLISH';
  if (verdict === 'STRONG_BEARISH') return 'WEAK_BEARISH';
  return verdict;
}

// ═══════════════════════════════════════════════════════════════
// COINBASE SPOT GUARD (Phase 1 - Confirmation Layer)
// ═══════════════════════════════════════════════════════════════

/**
 * Coinbase Spot Divergence Guard
 * 
 * If spot market diverges from derivatives verdict:
 * - confidence × 0.6
 * - adds COINBASE_SPOT_DIVERGENCE flag
 * 
 * RULE: NEVER changes verdict, ONLY downgrades confidence
 */
export function applyCoinbaseSpotGuard(
  verdict: FinalVerdict,
  confidence: number,
  coinbaseContext?: CoinbaseSpotContext
): { verdict: FinalVerdict; confidence: number; result: GuardResult } {
  // Skip if no Coinbase data
  if (!coinbaseContext || coinbaseContext.dataMode === 'NO_DATA') {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'coinbaseSpotGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: 'Coinbase spot data not available',
      },
    };
  }
  
  // Check for divergence
  const triggered = coinbaseContext.divergence;
  
  if (!triggered) {
    return {
      verdict,
      confidence,
      result: {
        guardName: 'coinbaseSpotGuard',
        triggered: false,
        confidenceDelta: 0,
        reason: `Spot confirms derivatives (spotBias=${coinbaseContext.spotBias}, volumeDelta=${coinbaseContext.volumeDelta})`,
      },
    };
  }
  
  // Apply downgrade
  const newConfidence = confidence * 0.6;
  
  return {
    verdict, // NEVER change verdict
    confidence: newConfidence,
    result: {
      guardName: 'coinbaseSpotGuard',
      triggered: true,
      confidenceDelta: -(confidence - newConfidence),
      reason: `Spot diverges from derivatives: spotBias=${coinbaseContext.spotBias}, volumeDelta=${coinbaseContext.volumeDelta}, priceDelta=${coinbaseContext.priceDelta}%`,
    },
  };
}

/**
 * Apply all guards in sequence
 */
export function applyAllGuards(
  verdict: FinalVerdict,
  confidence: number,
  ctx: MetaBrainV2Context,
  alignment: 'ALIGNED' | 'PARTIAL' | 'CONFLICT',
  coinbaseContext?: CoinbaseSpotContext
): { 
  finalVerdict: FinalVerdict; 
  finalConfidence: number; 
  guardsApplied: GuardResult[];
} {
  const guardsApplied: GuardResult[] = [];
  let currentVerdict = verdict;
  let currentConfidence = confidence;
  
  // 1. Readiness Guard
  const readinessResult = applyReadinessGuard(currentVerdict, currentConfidence, ctx);
  currentVerdict = readinessResult.verdict;
  currentConfidence = readinessResult.confidence;
  guardsApplied.push(readinessResult.result);
  
  // 2. Whale Risk Guard
  const whaleResult = applyWhaleRiskGuard(currentVerdict, currentConfidence, ctx);
  currentVerdict = whaleResult.verdict;
  currentConfidence = whaleResult.confidence;
  guardsApplied.push(whaleResult.result);
  
  // 3. Contradiction Guard (STRONG forbidden)
  const contradictResult = applyContradictionGuard(currentVerdict, currentConfidence, ctx);
  currentVerdict = contradictResult.verdict;
  currentConfidence = contradictResult.confidence;
  guardsApplied.push(contradictResult.result);
  
  // 4. Conflict + Contradiction → INCONCLUSIVE
  const conflictResult = applyConflictContradictionGuard(currentVerdict, currentConfidence, ctx, alignment);
  currentVerdict = conflictResult.verdict;
  currentConfidence = conflictResult.confidence;
  guardsApplied.push(conflictResult.result);
  
  // 5. Coinbase Spot Guard (confirmation layer - downgrade only)
  const coinbaseResult = applyCoinbaseSpotGuard(currentVerdict, currentConfidence, coinbaseContext);
  currentVerdict = coinbaseResult.verdict;
  currentConfidence = coinbaseResult.confidence;
  guardsApplied.push(coinbaseResult.result);
  
  // Ensure confidence is clamped
  currentConfidence = Math.max(0, Math.min(1, currentConfidence));
  
  return {
    finalVerdict: currentVerdict,
    finalConfidence: Math.round(currentConfidence * 100) / 100,
    guardsApplied,
  };
}

console.log('[C3] Guards Engine loaded');
