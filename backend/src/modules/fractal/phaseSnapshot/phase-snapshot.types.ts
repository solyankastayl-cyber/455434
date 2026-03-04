/**
 * BLOCK 76.3 — Phase Snapshot Types
 * 
 * Institutional Phase Strength Indicator
 * Provides real-time phase quality assessment for terminal header
 */

export type PhaseTier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';

export type PhaseGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type PhaseName = 
  | 'ACCUMULATION'
  | 'DISTRIBUTION' 
  | 'MARKUP'
  | 'MARKDOWN'
  | 'RECOVERY'
  | 'CAPITULATION'
  | 'UNKNOWN';

export type VolRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';

export type PhaseFlag = 
  | 'LOW_SAMPLE'
  | 'VERY_LOW_SAMPLE'
  | 'HIGH_DIVERGENCE'
  | 'HIGH_TAIL'
  | 'LOW_RECENCY'
  | 'NEGATIVE_SHARPE'
  | 'VOL_CRISIS';

export interface PhaseSnapshot {
  // Core identification
  symbol: string;
  focus: string;
  tier: PhaseTier;
  
  // Phase information
  phase: PhaseName;
  phaseId: string;
  
  // Quality metrics
  grade: PhaseGrade;
  score: number;              // 0-100
  strengthIndex: number;      // 0-1 normalized
  
  // Performance metrics
  hitRate: number;            // 0-1
  sharpe: number;             // -2 to +3 typical range
  expectancy: number;         // in decimal (0.021 = 2.1%)
  samples: number;
  
  // Context
  volRegime: VolRegime;
  divergenceScore: number;    // 0-100 (higher = more divergence)
  
  // Flags
  flags: PhaseFlag[];
  
  // Timestamp
  asof: string;
}

export interface PhaseSnapshotInput {
  focus: string;
  tier: PhaseTier;
  phase: PhaseName;
  phaseId: string;
  
  // From phase stats (73.6)
  score?: number;
  grade?: PhaseGrade;
  hitRate?: number;
  sharpe?: number;
  expectancy?: number;
  samples?: number;
  
  // From context
  volRegime: VolRegime;
  divergenceScore: number;
  entropy?: number;
  tailRisk?: number;
}

// Minimum samples per tier
export const MIN_SAMPLES_BY_TIER: Record<PhaseTier, number> = {
  TIMING: 8,
  TACTICAL: 12,
  STRUCTURE: 16,
};
