/**
 * EXPECTATION FEEDBACK SERVICE
 * ============================
 * 
 * Sends outcome feedback to ML for shadow learning.
 * NO direct retrain — only shadow signals for next cycle.
 */

import type { ExpectationOutcome } from '../contracts/expectation.outcome.types.js';
import type { MarketExpectation } from '../contracts/expectation.types.js';
import { getExpectationById } from './expectation.store.js';

// ═══════════════════════════════════════════════════════════════
// FEEDBACK SIGNAL TYPE
// ═══════════════════════════════════════════════════════════════

export interface MLFeedbackSignal {
  /** Source: always 'expectation_outcome' */
  source: 'expectation_outcome';
  
  /** Timestamp */
  timestamp: number;
  
  /** Asset */
  asset: string;
  
  /** Original expectation ID */
  expectationId: string;
  
  /** Verdict ID if linked */
  verdictId?: string;
  
  /** Did direction match? */
  directionHit: boolean;
  
  /** Signed error (-2 to 2) */
  error: number;
  
  /** Absolute error */
  absError: number;
  
  /** Realized move (%) */
  realizedMove: number;
  
  /** Macro regime at issuance */
  macroRegimeAtIssuance: string;
  
  /** Macro regime at evaluation */
  macroRegimeAtEvaluation: string;
  
  /** Regime changed? */
  regimeChanged: boolean;
  
  /** Confidence at issuance */
  confidence: number;
  
  /** Horizon */
  horizon: string;
  
  /** Features used */
  features: {
    macro: boolean;
    onchain: boolean;
    sentiment: boolean;
    labs: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// FEEDBACK GENERATOR
// ═══════════════════════════════════════════════════════════════

export async function generateFeedbackSignal(
  outcome: ExpectationOutcome
): Promise<MLFeedbackSignal | null> {
  const expectation = await getExpectationById(outcome.expectationId);
  if (!expectation) {
    console.log('[ExpectationFeedback] Expectation not found:', outcome.expectationId);
    return null;
  }
  
  const signal: MLFeedbackSignal = {
    source: 'expectation_outcome',
    timestamp: Date.now(),
    asset: expectation.asset,
    expectationId: expectation.id,
    verdictId: expectation.verdictId,
    directionHit: outcome.directionHit,
    error: outcome.error,
    absError: outcome.absError,
    realizedMove: outcome.realizedMove,
    macroRegimeAtIssuance: expectation.macroRegime,
    macroRegimeAtEvaluation: outcome.macroRegimeAtEvaluation,
    regimeChanged: outcome.regimeChanged,
    confidence: expectation.confidence,
    horizon: expectation.horizon,
    features: expectation.features,
  };
  
  console.log('[ExpectationFeedback] Generated signal:', {
    asset: signal.asset,
    hit: signal.directionHit,
    error: signal.error,
    regime: signal.macroRegimeAtIssuance,
  });
  
  return signal;
}

// ═══════════════════════════════════════════════════════════════
// FEEDBACK QUEUE (for ML shadow)
// ═══════════════════════════════════════════════════════════════

const feedbackQueue: MLFeedbackSignal[] = [];

export async function queueFeedbackForML(signal: MLFeedbackSignal): Promise<void> {
  feedbackQueue.push(signal);
  console.log(`[ExpectationFeedback] Queued for ML: ${signal.expectationId}`);
}

export async function getFeedbackQueue(): Promise<MLFeedbackSignal[]> {
  return [...feedbackQueue];
}

export async function clearFeedbackQueue(): Promise<number> {
  const count = feedbackQueue.length;
  feedbackQueue.length = 0;
  return count;
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATED FEEDBACK
// ═══════════════════════════════════════════════════════════════

export interface AggregatedFeedback {
  period: 'day' | 'week';
  totalSignals: number;
  hitRate: number;
  avgError: number;
  byRegime: Record<string, {
    count: number;
    hitRate: number;
    avgError: number;
  }>;
  byHorizon: Record<string, {
    count: number;
    hitRate: number;
  }>;
  weakPoints: string[];
  strongPoints: string[];
}

export async function aggregateFeedback(
  signals: MLFeedbackSignal[],
  period: 'day' | 'week' = 'day'
): Promise<AggregatedFeedback> {
  if (signals.length === 0) {
    return {
      period,
      totalSignals: 0,
      hitRate: 0,
      avgError: 0,
      byRegime: {},
      byHorizon: {},
      weakPoints: [],
      strongPoints: [],
    };
  }
  
  const hits = signals.filter(s => s.directionHit).length;
  const totalError = signals.reduce((sum, s) => sum + s.absError, 0);
  
  // By regime
  const byRegime: Record<string, { count: number; hitRate: number; avgError: number }> = {};
  for (const signal of signals) {
    const regime = signal.macroRegimeAtIssuance;
    if (!byRegime[regime]) {
      byRegime[regime] = { count: 0, hitRate: 0, avgError: 0 };
    }
    byRegime[regime].count++;
  }
  
  for (const regime of Object.keys(byRegime)) {
    const regimeSignals = signals.filter(s => s.macroRegimeAtIssuance === regime);
    const regimeHits = regimeSignals.filter(s => s.directionHit).length;
    const regimeError = regimeSignals.reduce((sum, s) => sum + s.absError, 0);
    byRegime[regime].hitRate = regimeHits / regimeSignals.length;
    byRegime[regime].avgError = regimeError / regimeSignals.length;
  }
  
  // By horizon
  const byHorizon: Record<string, { count: number; hitRate: number }> = {};
  for (const signal of signals) {
    const horizon = signal.horizon;
    if (!byHorizon[horizon]) {
      byHorizon[horizon] = { count: 0, hitRate: 0 };
    }
    byHorizon[horizon].count++;
  }
  
  for (const horizon of Object.keys(byHorizon)) {
    const horizonSignals = signals.filter(s => s.horizon === horizon);
    const horizonHits = horizonSignals.filter(s => s.directionHit).length;
    byHorizon[horizon].hitRate = horizonHits / horizonSignals.length;
  }
  
  // Find weak/strong points
  const weakPoints: string[] = [];
  const strongPoints: string[] = [];
  
  for (const [regime, stats] of Object.entries(byRegime)) {
    if (stats.hitRate < 0.5 && stats.count >= 5) {
      weakPoints.push(`Low accuracy in ${regime} (${(stats.hitRate * 100).toFixed(0)}%)`);
    }
    if (stats.hitRate > 0.75 && stats.count >= 5) {
      strongPoints.push(`High accuracy in ${regime} (${(stats.hitRate * 100).toFixed(0)}%)`);
    }
  }
  
  return {
    period,
    totalSignals: signals.length,
    hitRate: hits / signals.length,
    avgError: totalError / signals.length,
    byRegime,
    byHorizon,
    weakPoints,
    strongPoints,
  };
}

console.log('[MarketExpectation] Feedback service loaded');
