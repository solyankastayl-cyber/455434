/**
 * AE Terminal Contract — Main output
 * Aggregates all C1-C8 components
 */

import type { AeStateVector } from './ae_state.contract.js';
import type { AeRegimeResult } from './ae_regime.contract.js';
import type { AeCausalGraph } from './ae_causal.contract.js';
import type { AeScenarioPack } from './ae_scenarios.contract.js';
import type { AeNovelty } from './ae_novelty.contract.js';

export type GuardMode = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';

export interface AeRecommendation {
  sizeMultiplier: number;      // [0..1]
  guard: GuardMode;
  notes: string[];
}

export interface AeExplanation {
  headline: string;
  drivers: string[];
  limits: string[];
}

// C7 Cluster info
export interface AeClusterInfo {
  clusterId: number;
  label: string;
  distance: number;
}

// C8 Transition info
export interface AeTransitionInfo {
  currentLabel: string;
  mostLikelyNext: string;
  mostLikelyNextProb: number;
  selfTransitionProb: number;
  riskToStress: {
    p1w: number;
    p2w: number;
    p4w: number;
  };
  medianDurationWeeks: number;
}

export interface AeTerminal {
  ok: boolean;
  asOf: string;
  state: AeStateVector;
  regime: AeRegimeResult;
  causal: AeCausalGraph;
  scenarios: AeScenarioPack;
  novelty: AeNovelty;
  cluster?: AeClusterInfo;           // C7
  transition?: AeTransitionInfo;     // C8
  recommendation: AeRecommendation;
  explain: AeExplanation;
  computedAt: string;
}
