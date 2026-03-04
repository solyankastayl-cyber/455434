/**
 * EXPECTATION OUTCOME TYPES
 * =========================
 * 
 * What actually happened vs what we expected.
 * This is the ONLY place where expectation meets reality.
 */

import type { 
  ExpectationDirection, 
  MagnitudeBucket,
  MarketExpectation,
} from './expectation.types.js';

// ═══════════════════════════════════════════════════════════════
// OUTCOME RESULT
// ═══════════════════════════════════════════════════════════════

export interface ExpectationOutcome {
  /** Reference to original expectation */
  expectationId: string;
  
  /** When outcome was evaluated */
  evaluatedAt: number;
  
  /** Realized price move (%) */
  realizedMove: number;
  
  /** Realized direction */
  realizedDirection: ExpectationDirection;
  
  /** Did direction match? */
  directionHit: boolean;
  
  /** Realized magnitude bucket */
  realizedMagnitude: MagnitudeBucket;
  
  /** Did magnitude match? (if expected) */
  magnitudeHit: boolean | null;
  
  /** Signed error (realized - expected direction as number) */
  error: number;
  
  /** Absolute error */
  absError: number;
  
  /** Price at evaluation */
  priceAtEvaluation: number;
  
  /** Macro regime at evaluation (for comparison) */
  macroRegimeAtEvaluation: string;
  
  /** Regime changed during horizon? */
  regimeChanged: boolean;
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME CALCULATION
// ═══════════════════════════════════════════════════════════════

export function calculateOutcome(
  expectation: MarketExpectation,
  currentPrice: number,
  currentMacroRegime: string
): ExpectationOutcome {
  // Calculate price move
  const realizedMove = ((currentPrice - expectation.priceAtIssuance) / expectation.priceAtIssuance) * 100;
  
  // Determine realized direction
  let realizedDirection: ExpectationDirection;
  if (Math.abs(realizedMove) < 0.5) {
    realizedDirection = 'FLAT';
  } else if (realizedMove > 0) {
    realizedDirection = 'UP';
  } else {
    realizedDirection = 'DOWN';
  }
  
  // Check direction hit
  const directionHit = 
    expectation.direction === realizedDirection ||
    (expectation.direction === 'FLAT' && Math.abs(realizedMove) < 1);
  
  // Determine magnitude bucket
  const absMove = Math.abs(realizedMove);
  let realizedMagnitude: MagnitudeBucket;
  if (absMove < 2) {
    realizedMagnitude = 'SMALL';
  } else if (absMove < 5) {
    realizedMagnitude = 'MEDIUM';
  } else {
    realizedMagnitude = 'LARGE';
  }
  
  // Check magnitude hit (if expected)
  let magnitudeHit: boolean | null = null;
  if (expectation.expectedMagnitude) {
    magnitudeHit = expectation.expectedMagnitude === realizedMagnitude;
  }
  
  // Calculate error
  // Convert direction to number: UP=1, FLAT=0, DOWN=-1
  const directionToNum = (d: ExpectationDirection): number => {
    if (d === 'UP') return 1;
    if (d === 'DOWN') return -1;
    return 0;
  };
  
  const expectedNum = directionToNum(expectation.direction);
  const realizedNum = directionToNum(realizedDirection);
  const error = realizedNum - expectedNum;
  
  return {
    expectationId: expectation.id,
    evaluatedAt: Date.now(),
    realizedMove,
    realizedDirection,
    directionHit,
    realizedMagnitude,
    magnitudeHit,
    error,
    absError: Math.abs(error),
    priceAtEvaluation: currentPrice,
    macroRegimeAtEvaluation: currentMacroRegime,
    regimeChanged: expectation.macroRegime !== currentMacroRegime,
  };
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME STATISTICS
// ═══════════════════════════════════════════════════════════════

export interface OutcomeStats {
  totalEvaluated: number;
  directionHitRate: number;
  magnitudeHitRate: number;
  avgError: number;
  avgAbsError: number;
  byHorizon: Record<string, {
    count: number;
    hitRate: number;
  }>;
  byRegime: Record<string, {
    count: number;
    hitRate: number;
  }>;
}

export function calculateOutcomeStats(outcomes: ExpectationOutcome[]): OutcomeStats {
  if (outcomes.length === 0) {
    return {
      totalEvaluated: 0,
      directionHitRate: 0,
      magnitudeHitRate: 0,
      avgError: 0,
      avgAbsError: 0,
      byHorizon: {},
      byRegime: {},
    };
  }
  
  const directionHits = outcomes.filter(o => o.directionHit).length;
  const magnitudeOutcomes = outcomes.filter(o => o.magnitudeHit !== null);
  const magnitudeHits = magnitudeOutcomes.filter(o => o.magnitudeHit).length;
  
  const totalError = outcomes.reduce((sum, o) => sum + o.error, 0);
  const totalAbsError = outcomes.reduce((sum, o) => sum + o.absError, 0);
  
  return {
    totalEvaluated: outcomes.length,
    directionHitRate: directionHits / outcomes.length,
    magnitudeHitRate: magnitudeOutcomes.length > 0 ? magnitudeHits / magnitudeOutcomes.length : 0,
    avgError: totalError / outcomes.length,
    avgAbsError: totalAbsError / outcomes.length,
    byHorizon: {},
    byRegime: {},
  };
}

console.log('[MarketExpectation] Outcome types loaded');
