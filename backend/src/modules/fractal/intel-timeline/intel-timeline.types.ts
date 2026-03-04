/**
 * BLOCK 82 — Intel Timeline Types
 * 
 * Shared types for Phase Strength Timeline + Dominance History
 */

export type IntelTimelineSource = 'LIVE' | 'V2014' | 'V2020';
export type DominanceTier = 'STRUCTURE' | 'TACTICAL' | 'TIMING';
export type PhaseGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type PhaseType = 'MARKUP' | 'MARKDOWN' | 'DISTRIBUTION' | 'ACCUMULATION' | 'NEUTRAL';
export type VolRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'CRISIS';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Trend7d = 'UP' | 'DOWN' | 'FLAT';

export interface TierWeights {
  structure: number;
  tactical: number;
  timing: number;
}

export interface IntelTimelineEntry {
  date: string;
  phaseType: PhaseType;
  phaseGrade: PhaseGrade;
  phaseScore: number;
  dominanceTier: DominanceTier;
  structuralLock: boolean;
  tierWeights: TierWeights;
  consensusIndex: number;
  conflictLevel: string;
  volRegime: VolRegime;
  divergenceGrade: DivergenceGrade;
  divergenceScore: number;
  finalAction: string;
  finalSize: number;
}

export interface IntelTimelineStats {
  lockDays: number;
  structureDominancePct: number;
  tacticalDominancePct: number;
  timingDominancePct: number;
  switchCount: number;
  avgPhaseScore: number;
  avgConsensus: number;
  trend7d: Trend7d;
}

export interface IntelTimelineResponse {
  ok: boolean;
  meta: {
    symbol: string;
    source: IntelTimelineSource;
    window: number;
    from: string;
    to: string;
  };
  series: IntelTimelineEntry[];
  stats: IntelTimelineStats;
}

export interface IntelTimelineWriteInput {
  symbol: string;
  source: IntelTimelineSource;
  date?: string;  // defaults to today
  
  // Phase
  phaseType: PhaseType;
  phaseGrade: PhaseGrade;
  phaseScore: number;
  phaseSharpe: number;
  phaseHitRate: number;
  phaseExpectancy: number;
  phaseSamples: number;
  
  // Dominance
  dominanceTier: DominanceTier;
  structuralLock: boolean;
  timingOverrideBlocked: boolean;
  tierWeights: TierWeights;
  
  // Context
  volRegime: VolRegime;
  divergenceGrade: DivergenceGrade;
  divergenceScore: number;
  
  // Decision
  finalAction: string;
  finalSize: number;
  consensusIndex: number;
  conflictLevel: string;
  
  // Meta
  engineVersion?: string;
  policyHash?: string;
}
