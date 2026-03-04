/**
 * Shadow Mode Types
 * 
 * Types for V1 vs V2 comparison layer
 */

export interface V1Scores {
  decision: string;
  evidence: number;
  risk: number;
  confidence: number;
  coverage: number;
}

export interface V2Scores {
  decision: string;
  evidence: number;
  direction: number;
  risk: number;
  confidence: number;
  coverage: number;
  engineStatus: string;
}

export interface ShadowDiff {
  decisionChanged: boolean;
  evidenceDelta: number;
  riskDelta: number;
  coverageDelta: number;
  confidenceDelta: number;
}

export interface ShadowSnapshot {
  subject: { kind: string; id: string };
  window: string;
  v1: V1Scores;
  v2: V2Scores;
  diff: ShadowDiff;
  computedAt: Date;
}

export interface ShadowMetrics {
  agreementRate: number;
  decisionFlipRate: number;
  avgEvidenceDelta: number;
  avgRiskDelta: number;
  avgCoverageDelta: number;
  avgConfidenceDelta: number;
  falsePositivesRate: number;
  falseNegativesRate: number;
  samples: number;
  window: string;
  computedAt: string;
}

export type KillSwitchStatus = 'OK' | 'ALERT' | 'FORCE_V1';
