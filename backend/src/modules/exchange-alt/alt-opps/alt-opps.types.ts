/**
 * BLOCK 20 — Altcoin Opportunity Engine Types
 * ============================================
 * 
 * Central opportunity scoring and ranking.
 */

import type { Venue, Direction, Horizon, AltFacet } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY SCORE COMPONENTS
// ═══════════════════════════════════════════════════════════════

export interface OpportunityComponents {
  patternScore: number;      // 0-100: Pattern match quality
  momentumScore: number;     // 0-100: Current momentum alignment
  contextScore: number;      // 0-100: Market context fit
  timingScore: number;       // 0-100: Entry timing quality
  liquidityScore: number;    // 0-100: Execution feasibility
  historyScore: number;      // 0-100: Pattern historical performance
}

export interface AltOppScore {
  symbol: string;
  venue: Venue;
  
  // Final scores
  totalScore: number;        // 0-100 weighted sum
  confidence: number;        // 0-1 statistical confidence
  rank: number;              // 1-N position
  
  // Components
  components: OpportunityComponents;
  
  // Signal
  direction: Direction;
  horizon: Horizon;
  expectedMove: { min: number; max: number; prob: number };
  
  // Context
  patternId: string;
  patternLabel: string;
  facet: AltFacet;
  
  // Metadata
  reasons: string[];
  warnings: string[];
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// OPPORTUNITY FILTER
// ═══════════════════════════════════════════════════════════════

export interface OppFilter {
  minScore?: number;
  maxRank?: number;
  directions?: Direction[];
  facets?: AltFacet[];
  excludeSymbols?: string[];
  requireLiquidity?: boolean;
  requireHistoryProven?: boolean;
}

export const DEFAULT_OPP_FILTER: OppFilter = {
  minScore: 60,
  maxRank: 20,
  requireLiquidity: true,
  requireHistoryProven: false,
};

// ═══════════════════════════════════════════════════════════════
// AOE WEIGHTS
// ═══════════════════════════════════════════════════════════════

export interface AOEWeights {
  pattern: number;
  momentum: number;
  context: number;
  timing: number;
  liquidity: number;
  history: number;
}

export const DEFAULT_AOE_WEIGHTS: AOEWeights = {
  pattern: 0.25,
  momentum: 0.20,
  context: 0.15,
  timing: 0.15,
  liquidity: 0.10,
  history: 0.15,
};

// ═══════════════════════════════════════════════════════════════
// AOE RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface AOEResponse {
  ok: boolean;
  asOf: number;
  venue: Venue;
  
  // Results
  opportunities: AltOppScore[];
  totalScanned: number;
  passedFilter: number;
  
  // Stats
  avgScore: number;
  topPattern: string;
  dominantDirection: Direction;
  
  // Quality
  dataQuality: number;
  staleness: number;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function calculateTotalScore(
  components: OpportunityComponents,
  weights: AOEWeights = DEFAULT_AOE_WEIGHTS
): number {
  return (
    components.patternScore * weights.pattern +
    components.momentumScore * weights.momentum +
    components.contextScore * weights.context +
    components.timingScore * weights.timing +
    components.liquidityScore * weights.liquidity +
    components.historyScore * weights.history
  );
}

export function scoreToConfidence(score: number, samples: number): number {
  // Higher samples = higher confidence
  const sampleFactor = Math.min(1, samples / 100);
  const scoreFactor = score / 100;
  
  return scoreFactor * (0.5 + 0.5 * sampleFactor);
}

console.log('[Block20] Alt Opportunity Engine Types loaded');
