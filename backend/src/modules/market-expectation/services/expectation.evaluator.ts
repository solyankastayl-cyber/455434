/**
 * EXPECTATION EVALUATOR SERVICE
 * ==============================
 * 
 * Evaluates expectations against actual market outcomes.
 * This is the ONLY place where expectation meets reality.
 */

import type { MarketExpectation } from '../contracts/expectation.types.js';
import { 
  calculateOutcome, 
  type ExpectationOutcome 
} from '../contracts/expectation.outcome.types.js';
import {
  getPendingExpectationsForEvaluation,
  getExpectationById,
  updateExpectationStatus,
  saveOutcome,
} from './expectation.store.js';

// ═══════════════════════════════════════════════════════════════
// PRICE FETCHER (mock for now)
// ═══════════════════════════════════════════════════════════════

async function getCurrentPrice(asset: string): Promise<number> {
  // In production, this would fetch from exchange API
  // For now, return mock price based on asset
  if (asset === 'BTCUSDT') {
    return 95000 + Math.random() * 5000;
  }
  if (asset === 'ETHUSDT') {
    return 3500 + Math.random() * 500;
  }
  return 100 + Math.random() * 50;
}

async function getCurrentMacroRegime(): Promise<string> {
  // In production, fetch from macro-intel
  const regimes = [
    'BTC_FLIGHT_TO_SAFETY',
    'ALT_ROTATION',
    'BTC_LEADS_ALT_FOLLOW',
    'NEUTRAL',
  ];
  return regimes[Math.floor(Math.random() * regimes.length)];
}

// ═══════════════════════════════════════════════════════════════
// SINGLE EVALUATION
// ═══════════════════════════════════════════════════════════════

export async function evaluateExpectation(
  expectationId: string
): Promise<ExpectationOutcome | null> {
  const expectation = await getExpectationById(expectationId);
  if (!expectation) {
    console.log(`[ExpectationEvaluator] Expectation not found: ${expectationId}`);
    return null;
  }
  
  if (expectation.status !== 'PENDING') {
    console.log(`[ExpectationEvaluator] Already evaluated: ${expectationId}`);
    return null;
  }
  
  // Get current market state
  const currentPrice = await getCurrentPrice(expectation.asset);
  const currentMacroRegime = await getCurrentMacroRegime();
  
  // Calculate outcome
  const outcome = calculateOutcome(expectation, currentPrice, currentMacroRegime);
  
  // Save outcome
  await saveOutcome(outcome);
  
  // Update expectation status
  await updateExpectationStatus(expectationId, 'EVALUATED');
  
  console.log(`[ExpectationEvaluator] Evaluated ${expectationId}:`, {
    expected: expectation.direction,
    realized: outcome.realizedDirection,
    hit: outcome.directionHit,
    move: `${outcome.realizedMove.toFixed(2)}%`,
  });
  
  return outcome;
}

// ═══════════════════════════════════════════════════════════════
// BATCH EVALUATION
// ═══════════════════════════════════════════════════════════════

export async function evaluatePendingExpectations(): Promise<{
  evaluated: number;
  hits: number;
  misses: number;
  outcomes: ExpectationOutcome[];
}> {
  const pending = await getPendingExpectationsForEvaluation();
  console.log(`[ExpectationEvaluator] Found ${pending.length} pending expectations`);
  
  const outcomes: ExpectationOutcome[] = [];
  let hits = 0;
  let misses = 0;
  
  for (const expectation of pending) {
    const outcome = await evaluateExpectation(expectation.id);
    if (outcome) {
      outcomes.push(outcome);
      if (outcome.directionHit) {
        hits++;
      } else {
        misses++;
      }
    }
  }
  
  console.log(`[ExpectationEvaluator] Batch complete:`, {
    evaluated: outcomes.length,
    hits,
    misses,
    hitRate: outcomes.length > 0 ? `${(hits / outcomes.length * 100).toFixed(1)}%` : 'N/A',
  });
  
  return { evaluated: outcomes.length, hits, misses, outcomes };
}

// ═══════════════════════════════════════════════════════════════
// MANUAL EVALUATION (for testing)
// ═══════════════════════════════════════════════════════════════

export async function evaluateWithPrice(
  expectationId: string,
  currentPrice: number,
  currentMacroRegime: string
): Promise<ExpectationOutcome | null> {
  const expectation = await getExpectationById(expectationId);
  if (!expectation) {
    return null;
  }
  
  if (expectation.status !== 'PENDING') {
    return null;
  }
  
  const outcome = calculateOutcome(expectation, currentPrice, currentMacroRegime);
  await saveOutcome(outcome);
  await updateExpectationStatus(expectationId, 'EVALUATED');
  
  return outcome;
}

console.log('[MarketExpectation] Evaluator service loaded');
