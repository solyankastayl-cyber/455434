/**
 * SPX CONSENSUS ENGINE — Types
 * 
 * BLOCK B5.5 — SPX-only Consensus (3-tier, no BTC influence)
 * 
 * Provides institutional-grade decision framework for SPX.
 */

// ═══════════════════════════════════════════════════════════════
// CORE TYPES
// ═══════════════════════════════════════════════════════════════

export type Tier = 'TIMING' | 'TACTICAL' | 'STRUCTURE';
export type Direction = 'BULL' | 'BEAR' | 'NEUTRAL';
export type ConflictLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export type DivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Action = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';
export type Mode = 'TREND_FOLLOW' | 'COUNTER_TREND' | 'NO_TRADE';

export type SpxHorizon = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';

// ═══════════════════════════════════════════════════════════════
// HORIZON VOTE (per horizon input)
// ═══════════════════════════════════════════════════════════════

export interface HorizonVote {
  horizon: SpxHorizon;
  tier: Tier;
  direction: Direction;
  confidence: number;           // 0..1
  divergenceGrade: DivergenceGrade;
  blockers: string[];
  weight: number;               // Computed weight after modifiers
  voteScore: number;            // direction × confidence × weight × penalties
}

// ═══════════════════════════════════════════════════════════════
// HORIZON STACK INPUT
// ═══════════════════════════════════════════════════════════════

export interface HorizonInput {
  horizon: SpxHorizon;
  tier: Tier;
  direction: Direction;
  confidence: number;
  divergenceGrade: DivergenceGrade;
  blockers?: string[];
  medianReturn?: number;
  hitRate?: number;
}

// ═══════════════════════════════════════════════════════════════
// CONFLICT RESULT
// ═══════════════════════════════════════════════════════════════

export interface ConflictResult {
  level: ConflictLevel;
  dominance: Tier;
  structuralLock: boolean;
  description: string;
  tierDirections: Record<Tier, Direction | 'SPLIT'>;
}

// ═══════════════════════════════════════════════════════════════
// RESOLVED DECISION
// ═══════════════════════════════════════════════════════════════

export interface ResolvedDecision {
  action: Action;
  mode: Mode;
  sizeMultiplier: number;       // 0..1.25
  reasons: string[];
  penalties: string[];
}

// ═══════════════════════════════════════════════════════════════
// FULL CONSENSUS OUTPUT
// ═══════════════════════════════════════════════════════════════

export interface SpxConsensus {
  consensusIndex: number;       // 0..100
  direction: Direction;
  dominance: Tier;
  structuralLock: boolean;
  conflictLevel: ConflictLevel;
  votes: HorizonVote[];
  resolved: ResolvedDecision;
  
  // Metadata
  phaseType?: string;
  phaseFlags?: string[];
  computedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE INPUT
// ═══════════════════════════════════════════════════════════════

export interface SpxConsensusInput {
  horizonStack: HorizonInput[];
  phaseNow?: {
    phase: string;
    flags: string[];
    strength?: number;
  };
  preset?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}
