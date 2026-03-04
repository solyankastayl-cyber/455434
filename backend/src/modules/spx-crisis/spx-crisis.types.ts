/**
 * SPX CRISIS TYPES
 * 
 * BLOCK B6.10.2 — Types for Crisis Validation
 */

export interface EpochSkillCell {
  epoch: string;
  horizon: string;
  samples: number;
  baseUpRate: number;
  baseDownRate: number;
  hitTotal: number;
  skillTotal: number;   // hitTotal - max(baseUpRate, baseDownRate)
  skillUp: number;      // hitUp - baseUpRate
  skillDown: number;    // hitDown - baseDownRate
  // Extended metrics
  expectancy?: number;
  sharpe?: number;
  maxDD?: number;
}

export interface EpochSummary {
  epoch: string;
  label: string;
  type: string;
  stabilityScore: number;  // 0-100, % of horizons with skill >= 0
  verdict: 'STRONG' | 'MIXED' | 'FRAGILE';
  edgeSurvived: boolean;
  worst: {
    horizon: string;
    skillTotal: number;
  } | null;
  best: {
    horizon: string;
    skillTotal: number;
  } | null;
  totalSamples: number;
  horizonCount: number;
}

export interface CrisisSkillMatrix {
  preset: string;
  computedAt: string;
  totalEpochs: number;
  totalCells: number;
  rows: EpochSkillCell[];
  epochSummary: EpochSummary[];
  globalVerdict: 'EDGE_CONFIRMED' | 'EDGE_MIXED' | 'EDGE_FRAGILE' | 'NO_DATA';
  recommendations: string[];
}

export interface CrisisGuardrailCell {
  epoch: string;
  horizon: string;
  level: 'ALLOW' | 'CAUTION' | 'BLOCK';
  sizeCap: number;
  reasons: CrisisGuardrailReason[];
  metrics: {
    samples: number;
    skillTotal: number;
    skillUp?: number;
    skillDown?: number;
  };
}

export type CrisisGuardrailReason = 
  | 'NEG_SKILL_TOTAL'
  | 'NEG_SKILL_DOWN'
  | 'NEG_SKILL_UP'
  | 'LOW_SAMPLES'
  | 'EPOCH_FRAGILE'
  | 'HIGH_ASYMMETRY';

export interface CrisisGuardrailPolicy {
  version: string;
  preset: string;
  generatedAt: string;
  thresholds: {
    blockSkillTotal: number;
    cautionSkillTotal: number;
    blockSkillDown: number;
    minSamples: number;
  };
  defaultCaps: {
    allow: number;
    caution: number;
    block: number;
  };
  cells: CrisisGuardrailCell[];
  summary: {
    allowedCells: number;
    cautionCells: number;
    blockedCells: number;
  };
}
