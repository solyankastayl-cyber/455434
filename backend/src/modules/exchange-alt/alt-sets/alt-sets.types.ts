/**
 * BLOCK 11 — Alt-Sets & Ranking Types
 * =====================================
 * 
 * "Why these alts today" — concrete selection logic.
 */

import type { Venue, Direction } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// ALT SET TYPES
// ═══════════════════════════════════════════════════════════════

export type AltSetType = 
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'EARLY_REBOUND'
  | 'SHORT_SQUEEZE'
  | 'BREAKOUT'
  | 'MIXED';

export interface AltSetEntry {
  symbol: string;
  venue: Venue;
  
  // Scores
  altScore: number;           // Final ranking score
  groupScore: number;         // Pattern group contribution
  individualScore: number;    // Asset-specific contribution
  
  // Expected
  expectedMove: string;       // e.g., "12-18%"
  expectedDirection: Direction;
  horizon: '1h' | '4h' | '24h';
  
  // Pattern
  activePatterns: string[];
  patternLabel: string;
  
  // Why
  why: string;
  
  // Group info
  groupSize: number;          // Total in same pattern
  groupMovedCount: number;    // How many already moved
  groupRemainingRank: number; // Position among non-moved
  
  // Confidence
  confidence: number;
  regimeFit: boolean;
}

export interface AltSetResponse {
  type: AltSetType;
  asOf: number;
  venue: Venue;
  
  // Members
  entries: AltSetEntry[];
  
  // Group stats
  groupStats: {
    totalInPattern: number;
    alreadyMoved: number;
    avgMoveOfMoved: number;
    expectedRemainingMove: number;
  };
  
  // Market context
  regimeCompatible: boolean;
  marketRegime: string;
}

// ═══════════════════════════════════════════════════════════════
// RELATIVE OPPORTUNITY LOGIC
// ═══════════════════════════════════════════════════════════════

export interface GroupOpportunity {
  patternId: string;
  patternLabel: string;
  
  // Counts
  totalMembers: number;
  movedMembers: number;
  remainingMembers: number;
  
  // Performance of moved
  avgReturnMoved: number;
  
  // Score
  groupScore: number;
  
  // Remaining candidates
  candidates: string[];
}

/**
 * Calculate group opportunity score
 * 
 * groupScore = avgPatternWeight × successRate × (1 - alreadyMovedRatio)
 */
export function calculateGroupScore(
  patternWeight: number,
  successRate: number,
  movedRatio: number
): number {
  return patternWeight * successRate * (1 - movedRatio);
}

/**
 * Calculate expected move for remaining
 */
export function calculateExpectedMove(
  avgReturnMoved: number,
  discount: number = 0.7
): { min: number; max: number } {
  const discounted = avgReturnMoved * discount;
  return {
    min: Math.round(discounted * 0.6 * 100) / 100,
    max: Math.round(discounted * 1.2 * 100) / 100,
  };
}

console.log('[Block11] Alt-Sets Types loaded');
