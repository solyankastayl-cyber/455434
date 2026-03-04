/**
 * AE/S-Brain v2 — Brain Output Contract
 * 
 * What Brain returns to EngineGlobal.
 * Contains directives, scenarios, forecasts, and evidence.
 */

import { AssetId } from './asset_state.contract.js';

export type ScenarioName = 'BASE' | 'RISK' | 'TAIL';
export type RiskMode = 'RISK_ON' | 'NEUTRAL' | 'RISK_OFF';
export type Horizon = '30D' | '90D' | '180D' | '365D';

export interface ScenarioPack {
  name: ScenarioName;
  probs: Record<ScenarioName, number>;
  confidence: number;
  description?: string;
}

// P12.0: Scenario Diagnostics for explainability
export interface ScenarioDiagnostics {
  rawProbabilities: Record<ScenarioName, number>;
  afterPriors: Record<ScenarioName, number>;
  afterGate: Record<ScenarioName, number>;
  afterPenalty: Record<ScenarioName, number>;
  afterTemperature: Record<ScenarioName, number>;
  appliedTemperature: number;
  eligibilityGatePassed: boolean;
  tailEligibilityReasons: string[];
  tailRateRolling: number;
  concentration: number;
  scenarioPriorPenalty: number;
}

export interface HorizonForecast {
  mean?: number;
  q05?: number;
  q50?: number;
  q95?: number;
  tailRisk?: number; // 0..1
  direction?: 'UP' | 'DOWN' | 'NEUTRAL';
}

export interface AssetForecast {
  byHorizon: Partial<Record<Horizon, HorizonForecast>>;
}

export interface BrainDirectives {
  // Hard caps that override policy (deterministic)
  caps?: Partial<Record<AssetId, {
    maxSize?: number;
    minCash?: number;
  }>>;
  
  // Soft scaling suggestions
  scales?: Partial<Record<AssetId, {
    sizeScale?: number; // multiplier 0..1
  }>>;
  
  // Risk mode override
  riskMode?: RiskMode;
  
  // Cross-asset haircuts (multiply size by this)
  haircuts?: Partial<Record<AssetId, number>>;
  
  // Explicit warnings
  warnings?: string[];
  
  // NO_TRADE flag
  noTrade?: Partial<Record<AssetId, boolean>>;
}

export interface BrainEvidence {
  headline: string;
  drivers: string[];
  conflicts?: string[];
  whatWouldFlip?: string[];
  confidenceFactors?: string[];
}

export interface BrainOutputPack {
  asOf: string;
  
  // High-level scenario
  scenario: ScenarioPack;
  
  // P12.0: Scenario diagnostics for transparency
  scenarioDiagnostics?: ScenarioDiagnostics;
  
  // Per-asset forecasts (optional, for ML layer)
  forecasts?: Partial<Record<AssetId, AssetForecast>>;
  
  // The main output: directives for Engine
  directives: BrainDirectives;
  
  // Explainability
  evidence: BrainEvidence;
  
  // P10.3: MetaRisk integration
  meta: {
    engineVersion: string;
    brainVersion: string;
    computeTimeMs?: number;
    inputsHash?: string;
    // MetaRisk fields (added in P10.3)
    posture?: 'DEFENSIVE' | 'NEUTRAL' | 'OFFENSIVE';
    globalScale?: number;
    maxOverrideCap?: number;
  };
}

/**
 * Default "do nothing" brain output
 */
export function createNeutralBrainOutput(asOf: string): BrainOutputPack {
  return {
    asOf,
    scenario: {
      name: 'BASE',
      probs: { BASE: 0.7, RISK: 0.2, TAIL: 0.1 },
      confidence: 0.5,
    },
    directives: {
      riskMode: 'NEUTRAL',
    },
    evidence: {
      headline: 'No strong signals detected',
      drivers: [],
    },
    meta: {
      engineVersion: 'v2',
      brainVersion: 'v2.0.0',
    },
  };
}

/**
 * Validate brain output has required fields
 */
export function validateBrainOutput(pack: BrainOutputPack): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!pack.asOf) errors.push('asOf required');
  if (!pack.scenario) errors.push('scenario required');
  if (!pack.directives) errors.push('directives required');
  if (!pack.evidence) errors.push('evidence required');
  
  // Validate scenario probs sum to ~1
  if (pack.scenario?.probs) {
    const sum = Object.values(pack.scenario.probs).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.01) {
      errors.push(`scenario.probs must sum to 1, got ${sum}`);
    }
  }
  
  // Validate haircuts are 0..1
  if (pack.directives?.haircuts) {
    for (const [asset, val] of Object.entries(pack.directives.haircuts)) {
      if (val !== undefined && (val < 0 || val > 1)) {
        errors.push(`haircut for ${asset} must be 0..1, got ${val}`);
      }
    }
  }
  
  return { valid: errors.length === 0, errors };
}
