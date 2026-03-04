/**
 * Phase E: Decision Types
 * 
 * Final output contracts for TA Engine integration:
 * - Scenario: ranked hypothesis with probability
 * - DecisionPack: top scenarios + bench + audit meta
 */

import { PatternCandidate, HypothesisDirection } from '../hypothesis/builder/hypothesis_types.js';

export type BiasType = 'LONG' | 'SHORT' | 'WAIT';
export type ConfidenceLabel = 'LOW' | 'MED' | 'HIGH';
export type ProbabilitySource = 'CALIBRATED' | 'FALLBACK';

export interface ScenarioIntent {
  bias: BiasType;
  confidenceLabel: ConfidenceLabel;
}

export interface ScenarioWhy {
  headline: string[];
  bullets: string[];
}

export interface ScenarioMeta {
  createdAt: string;
  version: string;
}

export interface Scenario {
  scenarioId: string;
  rank: number;
  
  hypothesisId: string;
  direction: HypothesisDirection;
  
  // Scores
  score: number;           // 0..1 from Hypothesis Builder
  probability: number;     // 0..1 calibrated or fallback
  probabilitySource: ProbabilitySource;
  
  // Pattern components
  components: PatternCandidate[];
  
  // Trade intent
  intent: ScenarioIntent;
  
  // Explainability
  why: ScenarioWhy;
  
  // Metadata
  meta: ScenarioMeta;
}

export interface DecisionPackSummary {
  hypothesesIn: number;
  scenariosOut: number;
  droppedForDiversity: number;
  probabilityMode: ProbabilitySource;
}

export interface DecisionPackAudit {
  topHypothesisIds: string[];
  timestamp: string;
}

export interface DecisionPack {
  runId: string;
  asset: string;
  timeframe: string;
  
  engineVersion: string;
  
  // Top scenarios (usually 3)
  top: Scenario[];
  
  // Bench scenarios (next 5-7)
  bench: Scenario[];
  
  // Summary
  summary: DecisionPackSummary;
  
  // Audit trail
  audit: DecisionPackAudit;
}

// Risk Pack extension (optional, for trading integration)
export interface RiskPack {
  scenarioId: string;
  entry?: number;
  stop?: number;
  target1?: number;
  target2?: number;
  riskReward?: number;
  positionSizeHint?: 'SMALL' | 'NORMAL' | 'LARGE';
}
