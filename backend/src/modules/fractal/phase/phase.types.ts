/**
 * BLOCK 73.5 & 73.6 — Phase Module Types
 */

export type PhaseName =
  | 'ACCUMULATION'
  | 'DISTRIBUTION'
  | 'MARKUP'
  | 'MARKDOWN'
  | 'RECOVERY'
  | 'CAPITULATION'
  | 'UNKNOWN';

// BLOCK 73.5.1: Phase Stats for hover
export interface PhaseStats {
  phaseId: string;
  phase: PhaseName;
  from: string;
  to: string;
  durationDays: number;
  phaseReturnPct: number;
  volRegime: 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';
  matchesCount: number;
  matchIds: string[];
  bestMatchId: string | null;
  bestMatchSimilarity: number | null;
}

// BLOCK 73.6: Phase Performance (forward-truth)
export interface PhasePerfRow {
  phase: PhaseName;
  sample: number;
  hitRate: number;
  avgRealizedReturn: number;
  avgExpectedReturn?: number;
  avgAbsError?: number;
  worstRealizedReturn: number;
  bestRealizedReturn: number;
  avgTailP95?: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  flags: string[];
}

export interface PhasePerfResponse {
  meta: {
    symbol: 'BTC';
    preset: 'conservative' | 'balanced' | 'aggressive';
    role: 'ACTIVE' | 'SHADOW';
    horizonDays: 7 | 14 | 30 | 90 | 180 | 365;
    rangeDays: number;
    minN: number;
    resolvedTotal: number;
    usedTotal: number;
    currentPhase: PhaseName;
  };
  rows: PhasePerfRow[];
}
