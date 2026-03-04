/**
 * FORECAST EVALUATOR — Outcome calculation after horizon passes
 * ==============================================================
 * 
 * This is the core of the auto-learning system.
 * 
 * Evaluation rules:
 * - TP (True Positive): direction matched AND within band
 * - FP (False Positive): direction wrong
 * - FN (False Negative): direction right but missed target significantly
 * - WEAK: direction right but move was too small
 * 
 * Loss function for learning:
 *   loss = |deviationPct| × 0.6 + (directionMatch ? 0 : 0.4)
 */

import { getCurrentPrice } from '../../chart/services/price.service.js';
import {
  ForecastEvent,
  ForecastOutcome,
  ForecastOutcomeLabel,
} from './forecast.types.js';
import * as repository from './forecast.repository.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Minimum move threshold (below this = WEAK)
const WEAK_MOVE_THRESHOLD_PCT = 0.5;

// ═══════════════════════════════════════════════════════════════
// OUTCOME CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Determine outcome label based on forecast vs reality
 */
function determineOutcomeLabel(
  forecast: ForecastEvent,
  realPrice: number,
  directionMatch: boolean,
  hit: boolean
): ForecastOutcomeLabel {
  const realMovePct = ((realPrice - forecast.basePrice) / forecast.basePrice) * 100;
  const absRealMove = Math.abs(realMovePct);
  
  // If direction is wrong → FP
  if (!directionMatch) {
    return 'FP';
  }
  
  // If direction is right but move is tiny → WEAK
  if (absRealMove < WEAK_MOVE_THRESHOLD_PCT) {
    return 'WEAK';
  }
  
  // If within band → TP
  if (hit) {
    return 'TP';
  }
  
  // Direction right but missed the band (overshot or undershot)
  // This is technically a "miss" on the target, but direction was correct
  return 'FN';
}

/**
 * Evaluate a single forecast
 */
export async function evaluateForecast(
  forecast: ForecastEvent,
  realPrice: number
): Promise<ForecastOutcome> {
  const now = Date.now();
  
  // Calculate metrics
  const realMovePct = ((realPrice - forecast.basePrice) / forecast.basePrice) * 100;
  const deviationPct = Math.abs(
    (realPrice - forecast.targetPrice) / forecast.basePrice
  ) * 100;
  
  // Check direction match
  const actualDirection = realMovePct > 0.5 ? 'UP' : realMovePct < -0.5 ? 'DOWN' : 'FLAT';
  const directionMatch = 
    forecast.direction === actualDirection ||
    (forecast.direction === 'FLAT' && Math.abs(realMovePct) < 1);
  
  // Check if within band
  const hit = realPrice >= forecast.lowerBand && realPrice <= forecast.upperBand;
  
  // Determine label
  const label = determineOutcomeLabel(forecast, realPrice, directionMatch, hit);
  
  const outcome: ForecastOutcome = {
    realPrice,
    realMovePct: Math.round(realMovePct * 100) / 100,
    deviationPct: Math.round(deviationPct * 100) / 100,
    directionMatch,
    hit,
    label,
    evaluatedAt: now,
  };
  
  console.log(
    `[Evaluator] ${forecast.symbol}: ${label} ` +
    `expected=${forecast.expectedMovePct > 0 ? '+' : ''}${forecast.expectedMovePct}% ` +
    `actual=${realMovePct > 0 ? '+' : ''}${outcome.realMovePct}% ` +
    `deviation=${outcome.deviationPct}% ` +
    `dirMatch=${directionMatch} hit=${hit}`
  );
  
  return outcome;
}

// ═══════════════════════════════════════════════════════════════
// BATCH EVALUATION JOB
// ═══════════════════════════════════════════════════════════════

export interface EvaluationResult {
  processed: number;
  succeeded: number;
  failed: number;
  results: Array<{
    forecastId: string;
    symbol: string;
    label: ForecastOutcomeLabel;
    directionMatch: boolean;
    deviationPct: number;
  }>;
}

/**
 * Evaluate all pending forecasts
 * 
 * This should be called periodically (e.g., every 10 minutes)
 */
export async function evaluatePendingForecasts(): Promise<EvaluationResult> {
  const pending = await repository.getPendingEvaluations(50);
  
  if (pending.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, results: [] };
  }
  
  console.log(`[Evaluator] Processing ${pending.length} pending forecasts...`);
  
  const results: EvaluationResult['results'] = [];
  let succeeded = 0;
  let failed = 0;
  
  for (const forecast of pending) {
    try {
      // Get current price
      const realPrice = await getCurrentPrice(forecast.symbol);
      
      if (!realPrice) {
        console.warn(`[Evaluator] Could not get price for ${forecast.symbol}`);
        failed++;
        continue;
      }
      
      // Evaluate
      const outcome = await evaluateForecast(forecast, realPrice);
      
      // Save outcome
      await repository.updateForecastOutcome(forecast.id, outcome);
      
      results.push({
        forecastId: forecast.id,
        symbol: forecast.symbol,
        label: outcome.label,
        directionMatch: outcome.directionMatch,
        deviationPct: outcome.deviationPct,
      });
      
      succeeded++;
    } catch (error: any) {
      console.error(`[Evaluator] Error evaluating ${forecast.id}:`, error.message);
      failed++;
    }
  }
  
  console.log(
    `[Evaluator] Completed: ${succeeded} succeeded, ${failed} failed`
  );
  
  return {
    processed: pending.length,
    succeeded,
    failed,
    results,
  };
}

// ═══════════════════════════════════════════════════════════════
// LEARNING LOSS CALCULATION (for auto-learning integration)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate loss for a given outcome
 * 
 * Loss = |deviationPct| × 0.6 + (directionMatch ? 0 : 0.4)
 * 
 * This loss function:
 * - Penalizes wrong direction heavily (0.4)
 * - Penalizes deviation from target (scaled by deviation)
 * - Results in 0-1 range for reasonable deviations
 */
export function calculateLoss(outcome: ForecastOutcome): number {
  const deviationComponent = Math.min(1, outcome.deviationPct / 10) * 0.6;
  const directionComponent = outcome.directionMatch ? 0 : 0.4;
  
  return deviationComponent + directionComponent;
}

console.log('[Forecast] Evaluator loaded');
