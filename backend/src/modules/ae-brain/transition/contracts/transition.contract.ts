/**
 * C8 Transition Matrix Contracts
 * Type definitions for regime transition probabilities
 */

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export interface TransitionConfig {
  from: string;           // Start date (YYYY-MM-DD)
  to: string;             // End date (YYYY-MM-DD)
  stepDays: number;       // Transition step (default 7)
  alpha: number;          // Laplace smoothing (default 1)
}

// ═══════════════════════════════════════════════════════════════
// MATRIX RESULT
// ═══════════════════════════════════════════════════════════════

export interface TransitionMeta {
  from: string;
  to: string;
  stepDays: number;
  alpha: number;
  samples: number;        // Number of transitions counted
  labels: string[];       // Ordered label list
  computedAt: string;
}

export interface StressRisk {
  label: string;
  p1w: number;            // Risk in 1 week
  p2w: number;            // Risk in 2 weeks
  p4w: number;            // Risk in 4 weeks
}

export interface DerivedMetrics {
  stressLabels: string[];             // Labels considered as "stress"
  currentLabel: string;               // Current regime label
  riskToStress: StressRisk;           // Risk of transitioning to stress
  mostLikelyNext: string;             // Most probable next regime
  mostLikelyNextProb: number;
  selfTransitionProb: number;         // P(stay in same regime)
}

export interface TransitionMatrix {
  meta: TransitionMeta;
  matrix: number[][];     // N x N probability matrix
  rowSums: number[];      // Should all be ~1.0
  derived?: DerivedMetrics;
}

// ═══════════════════════════════════════════════════════════════
// DURATION STATS
// ═══════════════════════════════════════════════════════════════

export interface DurationStats {
  label: string;
  count: number;          // Number of episodes
  medianWeeks: number;
  meanWeeks: number;
  p90Weeks: number;
  maxWeeks: number;
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSES
// ═══════════════════════════════════════════════════════════════

export interface TransitionResponse {
  ok: boolean;
  matrix: TransitionMatrix;
}

export interface DurationResponse {
  ok: boolean;
  durations: DurationStats[];
}
