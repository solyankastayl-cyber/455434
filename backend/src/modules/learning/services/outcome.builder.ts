/**
 * PHASE 5.1 — Outcome Builder Service
 * =====================================
 * Calculates decision outcomes based on price movements
 */

import {
  DecisionOutcome,
  HorizonOutcome,
  OutcomeHorizon,
  OUTCOME_HORIZONS,
  HORIZON_MS,
} from '../contracts/outcome.types.js';
import { resolvePrice, getCurrentPrice } from './price.resolver.js';
import { DecisionRecord } from '../../finalDecision/contracts/decision.types.js';

/**
 * Calculate outcome for a single horizon
 */
async function calculateHorizonOutcome(
  symbol: string,
  decisionTimestamp: number,
  priceAtDecision: number,
  verdict: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  horizon: OutcomeHorizon
): Promise<HorizonOutcome> {
  const horizonMs = HORIZON_MS[horizon];
  const targetTimestamp = decisionTimestamp + horizonMs;
  const now = Date.now();
  
  // Check if enough time has passed
  if (now < targetTimestamp) {
    return {
      horizon,
      priceAtHorizon: null,
      changePct: null,
      directionCorrect: null,
      calculatedAt: null,
    };
  }
  
  // Resolve price at horizon
  const priceData = await resolvePrice(symbol, targetTimestamp, priceAtDecision);
  const priceAtHorizon = priceData.price;
  
  if (!priceAtHorizon || priceAtHorizon === 0) {
    return {
      horizon,
      priceAtHorizon: null,
      changePct: null,
      directionCorrect: null,
      calculatedAt: null,
    };
  }
  
  // Calculate change percentage
  const changePct = ((priceAtHorizon - priceAtDecision) / priceAtDecision) * 100;
  
  // Determine if direction was correct
  let directionCorrect: boolean | null = null;
  
  if (verdict === 'BULLISH') {
    // BULLISH is correct if price went up
    directionCorrect = changePct > 0;
  } else if (verdict === 'BEARISH') {
    // BEARISH is correct if price went down
    directionCorrect = changePct < 0;
  } else {
    // NEUTRAL is "correct" if price stayed within +/- 1%
    directionCorrect = Math.abs(changePct) < 1;
  }
  
  return {
    horizon,
    priceAtHorizon,
    changePct,
    directionCorrect,
    calculatedAt: now,
  };
}

/**
 * Build outcome for a decision
 */
export async function buildOutcome(
  decision: DecisionRecord
): Promise<Partial<DecisionOutcome>> {
  const now = Date.now();
  const decisionTimestamp = decision.timestamp;
  
  // Get current price for comparison
  const currentPrice = await getCurrentPrice(decision.symbol);
  const priceAtDecision = decision.explainability?.rawConfidence 
    ? currentPrice || 0 // Use current if no historical available
    : currentPrice || 0;
  
  // Calculate outcomes for each horizon
  const horizons: HorizonOutcome[] = await Promise.all(
    OUTCOME_HORIZONS.map(horizon =>
      calculateHorizonOutcome(
        decision.symbol,
        decisionTimestamp,
        priceAtDecision,
        decision.explainability.verdict as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        horizon
      )
    )
  );
  
  // Calculate aggregate metrics
  const calculatedHorizons = horizons.filter(h => h.calculatedAt !== null);
  
  let directionCorrect: boolean | null = null;
  let bestPnlPct: number | null = null;
  let worstPnlPct: number | null = null;
  
  if (calculatedHorizons.length > 0) {
    // Direction is correct if any horizon shows correct direction
    const correctCount = calculatedHorizons.filter(h => h.directionCorrect === true).length;
    directionCorrect = correctCount >= Math.ceil(calculatedHorizons.length / 2);
    
    // Calculate PnL metrics
    const pnls = calculatedHorizons
      .map(h => h.changePct)
      .filter((p): p is number => p !== null);
    
    if (pnls.length > 0) {
      // For BUY: positive change is good
      // For SELL: negative change is good (we'd be shorting)
      const adjustedPnls = decision.action === 'SELL' 
        ? pnls.map(p => -p) 
        : pnls;
      
      bestPnlPct = Math.max(...adjustedPnls);
      worstPnlPct = Math.min(...adjustedPnls);
    }
  }
  
  // Determine status
  const allCalculated = horizons.every(h => h.calculatedAt !== null);
  const anyCalculated = horizons.some(h => h.calculatedAt !== null);
  
  let status: 'PENDING' | 'CALCULATED' | 'SKIPPED' = 'PENDING';
  if (allCalculated) {
    status = 'CALCULATED';
  } else if (anyCalculated) {
    status = 'PENDING'; // Partially calculated
  }
  
  return {
    decisionId: decision._id?.toString() || '',
    symbol: decision.symbol,
    decisionTimestamp,
    action: decision.action,
    confidence: decision.confidence,
    verdict: decision.explainability.verdict as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
    priceAtDecision,
    horizons,
    directionCorrect,
    bestPnlPct,
    worstPnlPct,
    status,
    completedAt: status === 'CALCULATED' ? new Date() : undefined,
  };
}

/**
 * Should skip this decision for outcome tracking?
 */
export function shouldSkipDecision(decision: DecisionRecord): { skip: boolean; reason?: string } {
  // Skip if no decision ID
  if (!decision._id) {
    return { skip: true, reason: 'NO_DECISION_ID' };
  }
  
  // Skip MOCK data decisions (they have no real outcomes)
  if (decision.explainability.dataMode === 'MOCK') {
    return { skip: true, reason: 'MOCK_DATA' };
  }
  
  // Skip very old decisions (> 7 days)
  const ageMs = Date.now() - decision.timestamp;
  if (ageMs > 7 * 24 * 60 * 60 * 1000) {
    return { skip: true, reason: 'TOO_OLD' };
  }
  
  return { skip: false };
}

/**
 * Check if decision is ready for outcome calculation
 */
export function isReadyForCalculation(decisionTimestamp: number): boolean {
  const now = Date.now();
  const minHorizonMs = HORIZON_MS['1h'];
  
  // Ready if at least 1 hour has passed
  return (now - decisionTimestamp) >= minHorizonMs;
}

console.log('[Phase 5.1] Outcome Builder Service loaded');
