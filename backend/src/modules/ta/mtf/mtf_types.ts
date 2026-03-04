/**
 * Phase M: Multi-Timeframe Types
 * 
 * Aggregates decisions from 1D/4H/1H into unified MTF decision
 */

export type TF = '1D' | '4H' | '1H';

export interface MTFConfig {
  tfBias: TF;       // '1D' - direction anchor
  tfSetup: TF;      // '4H' - setup/patterns
  tfTrigger: TF;    // '1H' - entry trigger

  // Gating
  requireBiasAgreement: boolean;     // true
  minSetupProbability: number;       // 0.55
  minTriggerScore: number;           // 0.55
  maxConflictPenalty: number;        // 0.25

  // Blending weights
  wBias: number;      // 0.45
  wSetup: number;     // 0.35
  wTrigger: number;   // 0.20

  // Regime degradation
  regimePenalty: {
    transition: number;  // 0.10
    extremeVol: number;  // 0.15
  };

  engineVersion: string;
}

export const DEFAULT_MTF_CONFIG: MTFConfig = {
  tfBias: '1D',
  tfSetup: '4H',
  tfTrigger: '1H',

  requireBiasAgreement: true,
  minSetupProbability: 0.55,
  minTriggerScore: 0.55,
  maxConflictPenalty: 0.25,

  wBias: 0.45,
  wSetup: 0.35,
  wTrigger: 0.20,

  regimePenalty: {
    transition: 0.10,
    extremeVol: 0.15,
  },

  engineVersion: 'mtf_v1',
};

export interface MTFInput {
  asset: string;
  biasPack: any;     // DecisionPack for 1D
  setupPack: any;    // DecisionPack for 4H
  triggerPack: any;  // DecisionPack for 1H
}

export interface MTFScenario {
  id: string;
  direction: 'BULL' | 'BEAR' | 'NEUTRAL';
  probability: number;
  confidence: 'HIGH' | 'MED' | 'LOW';
  intent: 'LONG' | 'SHORT' | 'WAIT';

  // Provenance
  bias: {
    p: number;
    regime: string;
    vol: string;
    runId: string;
    scenarioId: string;
  };
  setup: {
    p: number;
    runId: string;
    scenarioId: string;
    primaryPattern?: string;
    rr?: number;
  };
  trigger: {
    score: number;
    runId: string;
    scenarioId: string;
    triggerType?: string;
  };

  // Risk pack from trigger or setup
  riskPack: any;

  // Diagnostics
  penalties: string[];
  reasons: string[];
}

export interface MTFDecisionPack {
  asset: string;
  createdAt: number;
  config: MTFConfig;

  topBias: 'LONG' | 'SHORT' | 'WAIT';
  scenarios: MTFScenario[];

  audit: {
    biasRunId: string;
    setupRunId: string;
    triggerRunId: string;
    mtfRunId: string;
  };
}

// MongoDB documents
export interface MTFRunDoc {
  mtfRunId: string;
  asset: string;
  createdAt: Date;
  cfg: MTFConfig;
  biasRunId: string;
  setupRunId: string;
  triggerRunId: string;
}

export interface MTFDecisionDoc {
  mtfRunId: string;
  asset: string;
  createdAt: Date;
  decision: MTFDecisionPack;
}
