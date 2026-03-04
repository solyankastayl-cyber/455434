/**
 * BLOCK 2.5 + 2.6 — Alt Candidate Types
 * ======================================
 */

import type { ObjectId } from 'mongodb';

export type Horizon = '1h' | '4h' | '24h';
export type Direction = 'UP' | 'DOWN' | 'WATCH';
export type OutcomeLabel =
  | 'TRUE_POSITIVE'
  | 'FALSE_POSITIVE'
  | 'TRUE_NEGATIVE'
  | 'FALSE_NEGATIVE'
  | 'WEAK'
  | 'NEUTRAL'
  | 'NO_DATA';

// ═══════════════════════════════════════════════════════════════
// CANDIDATE (from API response)
// ═══════════════════════════════════════════════════════════════

export interface AltCandidate {
  symbol: string;
  price: number;
  change24h: number;
  confidence: number;           // 0..1 (final)
  direction: Direction;
  expectedMovePct: number;
  reasons: string[];
  drivers: {
    cluster: string;
    clusterScore: number;
    funding: {
      z: number;
      crowdedness: number;
      bias: 'UP' | 'DOWN' | 'NEUTRAL';
      dispersion?: number;
    };
    exchange: {
      regime?: string;
      oiDelta?: number;
      liqPressure?: number;
      orderbookImb?: number;
      rsi?: number;
    };
  };
  tags: string[];
}

// ═══════════════════════════════════════════════════════════════
// CANDIDATE SNAPSHOT (stored per run)
// ═══════════════════════════════════════════════════════════════

export interface AltCandidateSnapshot {
  _id?: ObjectId;
  ts: Date;
  horizon: Horizon;
  venue: string;
  universeSize: number;
  buckets: {
    UP: AltCandidate[];
    DOWN: AltCandidate[];
    WATCH: AltCandidate[];
  };
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION (frozen bet per symbol)
// ═══════════════════════════════════════════════════════════════

export interface AltCandidatePrediction {
  _id?: ObjectId;
  snapshotId: ObjectId;
  ts: Date;
  horizon: Horizon;
  venue: string;
  symbol: string;
  price0: number;
  direction: Direction;
  confidence: number;
  expectedMovePct: number;
  drivers?: AltCandidate['drivers'];
  tags?: string[];
  outcomeStatus: 'PENDING' | 'DONE' | 'SKIPPED';
  dueAt: Date;
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// OUTCOME (evaluation result)
// ═══════════════════════════════════════════════════════════════

export interface AltCandidateOutcome {
  _id?: ObjectId;
  predictionId: ObjectId;
  snapshotId: ObjectId;
  ts0: Date;
  dueAt: Date;
  horizon: Horizon;
  symbol: string;
  venue: string;
  price0: number;
  priceT: number | null;
  retPct: number | null;
  directionPred: Direction;
  confidence: number;
  label: OutcomeLabel;
  score: number;              // -1..+1
  notes?: string[];
  createdAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// LEARNING SAMPLE
// ═══════════════════════════════════════════════════════════════

export interface AltLearningSample {
  _id?: ObjectId;
  ts0: Date;
  horizon: Horizon;
  symbol: string;
  x: Record<string, number>;  // features (flat numeric)
  y: number;                  // target: +1/-1/0
  label: OutcomeLabel;
  meta: {
    confidence: number;
    cluster?: string;
    fundingZ?: number;
    venue?: string;
    snapshotId?: ObjectId;
    predictionId?: ObjectId;
  };
  createdAt: Date;
}

console.log('[Alts] DB Types loaded');
