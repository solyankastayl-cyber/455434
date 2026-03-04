/**
 * Phase U: Performance Engine - Family Budgets
 * 
 * Limits for each detector family to prevent O(n²) explosion.
 * Better to have 80 quality candidates than 5000 noise.
 */

import { FamilyName } from './family_gate.js';

export interface FamilyBudget {
  maxCandidates: number;      // Max patterns to emit
  maxPairs: number;           // Max point pairs to consider
  maxIterations: number;      // Max iterations for RANSAC-like algos
  timeoutMs: number;          // Per-family timeout
}

/**
 * Budget configurations per family
 */
export const FAMILY_BUDGETS: Record<FamilyName, FamilyBudget> = {
  STRUCTURE: {
    maxCandidates: 50,
    maxPairs: 500,
    maxIterations: 100,
    timeoutMs: 500,
  },
  
  LEVELS: {
    maxCandidates: 100,
    maxPairs: 1000,
    maxIterations: 200,
    timeoutMs: 800,
  },
  
  BREAKOUTS: {
    maxCandidates: 80,
    maxPairs: 600,
    maxIterations: 150,
    timeoutMs: 600,
  },
  
  TRIANGLES: {
    maxCandidates: 60,
    maxPairs: 800,
    maxIterations: 120,
    timeoutMs: 700,
  },
  
  FLAGS: {
    maxCandidates: 50,
    maxPairs: 500,
    maxIterations: 100,
    timeoutMs: 500,
  },
  
  REVERSALS: {
    maxCandidates: 100,
    maxPairs: 1200,
    maxIterations: 200,
    timeoutMs: 800,
  },
  
  HARMONICS: {
    maxCandidates: 120,
    maxPairs: 2000,
    maxIterations: 300,
    timeoutMs: 1200,
  },
  
  ELLIOTT: {
    maxCandidates: 80,
    maxPairs: 1500,
    maxIterations: 250,
    timeoutMs: 1500,
  },
  
  CANDLES: {
    maxCandidates: 300, // Linear scan, more allowed
    maxPairs: 300,
    maxIterations: 300,
    timeoutMs: 400,
  },
  
  DIVERGENCES: {
    maxCandidates: 80,
    maxPairs: 800,
    maxIterations: 150,
    timeoutMs: 600,
  },
  
  MICROSTRUCTURE: {
    maxCandidates: 60,
    maxPairs: 500,
    maxIterations: 100,
    timeoutMs: 500,
  },
  
  VOLUME: {
    maxCandidates: 100,
    maxPairs: 200,
    maxIterations: 100,
    timeoutMs: 300,
  },
  
  MA_PATTERNS: {
    maxCandidates: 60,
    maxPairs: 400,
    maxIterations: 100,
    timeoutMs: 500,
  },
  
  LIQUIDITY: {
    maxCandidates: 80,
    maxPairs: 600,
    maxIterations: 120,
    timeoutMs: 500,
  },
  
  TREND_GEOMETRY: {
    maxCandidates: 60,
    maxPairs: 800,
    maxIterations: 150,
    timeoutMs: 700,
  },
};

/**
 * Get budget for a family
 */
export function getBudget(family: FamilyName): FamilyBudget {
  return FAMILY_BUDGETS[family] || {
    maxCandidates: 50,
    maxPairs: 500,
    maxIterations: 100,
    timeoutMs: 500,
  };
}

/**
 * Apply budget to patterns array
 */
export function applyBudget<T>(items: T[], budget: FamilyBudget): T[] {
  if (items.length <= budget.maxCandidates) {
    return items;
  }
  return items.slice(0, budget.maxCandidates);
}

/**
 * Check if budget is exceeded
 */
export function isBudgetExceeded(
  current: { candidates: number; pairs: number; iterations: number },
  budget: FamilyBudget
): boolean {
  return (
    current.candidates >= budget.maxCandidates ||
    current.pairs >= budget.maxPairs ||
    current.iterations >= budget.maxIterations
  );
}
