/**
 * BLOCK 7 — Meta-Brain Integration Types
 * ========================================
 * 
 * Exchange layer becomes Alpha Candidate generator.
 * Meta-Brain weighs but doesn't override.
 */

import type { AltFacet, Direction, Horizon } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';

// ═══════════════════════════════════════════════════════════════
// EXCHANGE ALPHA CANDIDATE (Exchange → Meta-Brain contract)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeAlphaCandidate {
  asset: string;
  tf: '1h' | '4h' | '1d';
  
  // Scores
  opportunityScore: number;  // From Block 5
  mlProbUp: number;          // From Block 6
  mlProbDown: number;
  patternConfidence: number;
  
  // Pattern info
  patternId: string;
  patternLabel: string;
  
  // Drivers (simplified for Meta-Brain)
  drivers: {
    rsi: number;
    funding: number;
    oi: number;
    volume: number;
    liquidations: number;
    trend: number;
  };
  
  // Market context
  marketContext: MarketContext;
  
  // Explanation
  reasons: string[];
}

// ═══════════════════════════════════════════════════════════════
// LAYER WEIGHTS
// ═══════════════════════════════════════════════════════════════

export const LAYER_WEIGHTS = {
  exchange: 1.0,      // Currently active
  onchain: 0.0,       // Frozen
  sentiment: 0.0,     // Frozen
} as const;

// ═══════════════════════════════════════════════════════════════
// DECISION COMPOSER
// ═══════════════════════════════════════════════════════════════

export interface MetaDecisionInput {
  candidate: ExchangeAlphaCandidate;
  marketAlignment: number;
  riskGuard: number;
}

export interface AlphaInsight {
  asset: string;
  score: number;
  confidence: number;
  direction: Direction;
  facet: AltFacet;
  
  // Explanation
  why: string[];
  patternId: string;
  
  // Expected
  expectedMove?: {
    horizon: Horizon;
    minPct: number;
    maxPct: number;
    probability: number;
  };
  
  // Meta
  source: 'EXCHANGE' | 'ONCHAIN' | 'SENTIMENT' | 'COMBINED';
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// GUARD THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const META_GUARDS = {
  minMlProbUp: 0.55,
  minSamples: 20,
  minPatternConfidence: 0.3,
  maxVolatilityExtreme: true,
  fundingThreshold: 0.0003,
} as const;

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate market alignment factor
 */
export function calculateMarketAlignment(regime: string): number {
  switch (regime) {
    case 'RANGE': return 0.9;
    case 'BULL': return 1.1;
    case 'BEAR': return 0.7;
    case 'RISK_OFF': return 0.4;
    default: return 0.8;
  }
}

/**
 * Calculate risk guard factor
 */
export function calculateRiskGuard(
  funding: number,
  volatilityExtreme: boolean
): number {
  let guard = 1.0;
  
  if (Math.abs(funding) > META_GUARDS.fundingThreshold) {
    guard *= 0.85;
  }
  
  if (volatilityExtreme) {
    guard *= 0.7;
  }
  
  return guard;
}

/**
 * Check if candidate passes guards
 */
export function passesGuards(
  candidate: ExchangeAlphaCandidate
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  
  if (candidate.mlProbUp < META_GUARDS.minMlProbUp && 
      candidate.mlProbDown < META_GUARDS.minMlProbUp) {
    reasons.push(`ML probability below ${META_GUARDS.minMlProbUp}`);
  }
  
  if (candidate.patternConfidence < META_GUARDS.minPatternConfidence) {
    reasons.push(`Pattern confidence below ${META_GUARDS.minPatternConfidence}`);
  }
  
  if (candidate.marketContext.marketRegime === 'RISK_OFF') {
    reasons.push('Market in RISK_OFF mode');
  }
  
  return {
    passed: reasons.length === 0,
    reasons,
  };
}

console.log('[Block7] Meta-Brain Integration Types loaded');
