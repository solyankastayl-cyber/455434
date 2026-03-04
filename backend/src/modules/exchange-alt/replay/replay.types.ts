/**
 * BLOCK 8 — Replay & Snapshot Types
 * ===================================
 * 
 * Day-by-day replay without magic.
 * Reproduces each day as if it were "now".
 */

import type { IndicatorVector, Venue, Timeframe } from '../types.js';
import type { MarketContext } from '../ml/ml.types.js';

// ═══════════════════════════════════════════════════════════════
// DAILY SNAPSHOT (What the system saw)
// ═══════════════════════════════════════════════════════════════

export interface DailySnapshot {
  _id?: any;
  
  date: string;            // YYYY-MM-DD
  asset: string;
  venue: Venue;
  tf: Timeframe;
  
  // Indicators at that moment
  indicators: IndicatorVector;
  
  // Pattern assignment
  patternId: string;
  patternLabel: string;
  clusterId?: string;
  
  // Scores (without future knowledge)
  opportunityScore: number;
  mlProbUp: number;
  mlConfidence: number;
  
  // Context
  marketContext: MarketContext;
  
  // Meta
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// REPLAY OUTCOME (What happened later)
// ═══════════════════════════════════════════════════════════════

export interface ReplayOutcome {
  _id?: any;
  
  asset: string;
  date: string;            // Date of original snapshot
  
  // Horizons
  horizon: '1d' | '3d' | '7d';
  returnPct: number;
  
  // Label
  label: 'GOOD_PICK' | 'FLAT' | 'BAD_PICK';
  
  // Reference
  snapshotId?: string;
  patternId: string;
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// SELECTION METRICS (Quality of selection)
// ═══════════════════════════════════════════════════════════════

export interface SelectionMetrics {
  date: string;
  horizon: '1d' | '3d' | '7d';
  
  // Counts
  picks: number;
  goodPicks: number;
  flatPicks: number;
  badPicks: number;
  
  // Rates
  precision: number;       // good / picks
  recall: number;          // good / all good opportunities
  avgReturn: number;
  medianReturn: number;
  
  // Pattern breakdown
  patternStats: Record<string, {
    count: number;
    goodCount: number;
    avgReturn: number;
  }>;
  
  // Comparison with baseline
  vsBaseline: {
    randomAvgReturn: number;
    topVolumeAvgReturn: number;
    outperformance: number;
  };
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// PATTERN VALIDATION
// ═══════════════════════════════════════════════════════════════

export interface PatternValidation {
  patternId: string;
  patternLabel: string;
  
  // Stats
  totalOccurrences: number;
  selectedCount: number;
  successfulSelections: number;
  
  // Rates
  selectionRate: number;   // selected / total
  successRate: number;     // successful / selected
  missedOpportunities: number;
  
  // Score
  validationScore: number; // composite
  
  // Recommendation
  recommendation: 'INCREASE_WEIGHT' | 'DECREASE_WEIGHT' | 'MAINTAIN' | 'FREEZE';
  reason: string;
  
  updatedAt: number;
}

// ═══════════════════════════════════════════════════════════════
// LABELING FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export const REPLAY_THRESHOLDS = {
  GOOD_PICK: 5,    // > 5% = GOOD
  BAD_PICK: -3,    // < -3% = BAD
  // else FLAT
} as const;

export function labelReplayOutcome(returnPct: number): 'GOOD_PICK' | 'FLAT' | 'BAD_PICK' {
  if (returnPct > REPLAY_THRESHOLDS.GOOD_PICK) return 'GOOD_PICK';
  if (returnPct < REPLAY_THRESHOLDS.BAD_PICK) return 'BAD_PICK';
  return 'FLAT';
}

console.log('[Block8] Replay Types loaded');
