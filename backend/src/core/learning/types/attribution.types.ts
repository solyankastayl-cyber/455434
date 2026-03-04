/**
 * Attribution Outcome Link Types
 * 
 * ETAP 3.3: Type definitions for attribution → outcome linking.
 * Connects signals to outcomes to determine what actually worked.
 */

import type { Bucket, Horizon, DriftLevel } from '../learning.types.js';
import type { TrendLabel, DelayLabel } from './trend.types.js';

// ==================== VERDICT ====================

export type Verdict = 
  | 'TRUE_POSITIVE'     // Decision matched trend (BUY→UP, SELL→DOWN)
  | 'FALSE_POSITIVE'    // Decision opposite to trend (BUY→DOWN, SELL→UP)
  | 'TRUE_NEGATIVE'     // WATCH was correct (SIDEWAYS/NOISE)
  | 'FALSE_NEGATIVE'    // WATCH missed a trend
  | 'MISSED'            // System failed to act on obvious trend
  | 'DELAYED_TRUE';     // Correct but delayed (1d miss, 7d/30d hit)

// ==================== SIGNAL CONTRIBUTION ====================

export interface SignalContribution {
  key: string;              // Signal identifier (e.g., 'dexFlow', 'whale', 'engineConfidence')
  source: 'actor' | 'engine' | 'live' | 'market';
  value: number;            // Signal value at decision time
  weight: number;           // Contribution weight to decision
  direction: 'positive' | 'negative' | 'neutral';
}

export interface SignalContribSummary {
  positiveSignals: SignalContribution[];
  negativeSignals: SignalContribution[];
  conflicts: Array<{
    key: string;
    conflictScore: number;
  }>;
  topContributor: string | null;
  totalPositive: number;
  totalNegative: number;
}

// ==================== QUALITY METRICS ====================

export interface LinkQuality {
  liveApprovedCoverage: number;     // 0..1 - how much LIVE data was approved
  driftLevel: DriftLevel;
  confidenceModifierApplied: number; // Modifier from drift
  trendConfidence: number;          // From TrendValidation
  dataCompleteness: number;         // 0..1 - how complete the data chain is
}

// ==================== VERDICT MATRIX CONFIG ====================

export interface VerdictInput {
  bucket: Bucket;
  trendLabel: TrendLabel;
  delayLabel: DelayLabel;
  horizon: Horizon;
}

/**
 * Verdict determination rules (deterministic)
 */
export const VERDICT_RULES: Record<Bucket, Record<TrendLabel, Record<DelayLabel, Verdict>>> = {
  BUY: {
    TREND_UP: {
      INSTANT: 'TRUE_POSITIVE',
      DELAYED: 'DELAYED_TRUE',
      LATE: 'DELAYED_TRUE',
      NONE: 'TRUE_POSITIVE',  // Edge case: trend exists but no clear delay
    },
    TREND_DOWN: {
      INSTANT: 'FALSE_POSITIVE',
      DELAYED: 'FALSE_POSITIVE',
      LATE: 'FALSE_POSITIVE',
      NONE: 'FALSE_POSITIVE',
    },
    SIDEWAYS: {
      INSTANT: 'FALSE_POSITIVE',  // BUY on sideways = wrong
      DELAYED: 'DELAYED_TRUE',    // Might become UP later
      LATE: 'DELAYED_TRUE',
      NONE: 'FALSE_POSITIVE',
    },
    NOISE: {
      INSTANT: 'FALSE_POSITIVE',
      DELAYED: 'DELAYED_TRUE',
      LATE: 'DELAYED_TRUE',
      NONE: 'FALSE_POSITIVE',
    },
  },
  SELL: {
    TREND_DOWN: {
      INSTANT: 'TRUE_POSITIVE',
      DELAYED: 'DELAYED_TRUE',
      LATE: 'DELAYED_TRUE',
      NONE: 'TRUE_POSITIVE',
    },
    TREND_UP: {
      INSTANT: 'FALSE_POSITIVE',
      DELAYED: 'FALSE_POSITIVE',
      LATE: 'FALSE_POSITIVE',
      NONE: 'FALSE_POSITIVE',
    },
    SIDEWAYS: {
      INSTANT: 'FALSE_POSITIVE',
      DELAYED: 'DELAYED_TRUE',
      LATE: 'DELAYED_TRUE',
      NONE: 'FALSE_POSITIVE',
    },
    NOISE: {
      INSTANT: 'FALSE_POSITIVE',
      DELAYED: 'DELAYED_TRUE',
      LATE: 'DELAYED_TRUE',
      NONE: 'FALSE_POSITIVE',
    },
  },
  WATCH: {
    SIDEWAYS: {
      INSTANT: 'TRUE_NEGATIVE',
      DELAYED: 'TRUE_NEGATIVE',
      LATE: 'TRUE_NEGATIVE',
      NONE: 'TRUE_NEGATIVE',
    },
    NOISE: {
      INSTANT: 'TRUE_NEGATIVE',
      DELAYED: 'TRUE_NEGATIVE',
      LATE: 'TRUE_NEGATIVE',
      NONE: 'TRUE_NEGATIVE',
    },
    TREND_UP: {
      INSTANT: 'MISSED',         // Should have been BUY
      DELAYED: 'FALSE_NEGATIVE', // Trend appeared later
      LATE: 'FALSE_NEGATIVE',
      NONE: 'MISSED',
    },
    TREND_DOWN: {
      INSTANT: 'MISSED',         // Should have been SELL
      DELAYED: 'FALSE_NEGATIVE',
      LATE: 'FALSE_NEGATIVE',
      NONE: 'MISSED',
    },
  },
};
