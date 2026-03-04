/**
 * Stress Simulation Contract
 */

export interface StressSimRequest {
  asset: string;
  start: string;
  end: string;
  stepDays: number;
  scenarioPreset: string;
}

export interface StressSimReport {
  scenarioPreset: string;
  window: { start: string; end: string; nSteps: number };

  stability: {
    flipStormDetected: boolean;
    maxOverrideIntensity: number;
    avgOverrideIntensity: number;
    nanDetected: boolean;
    scenarioFlipCount: number;
  };

  safety: {
    allocationSumValid: boolean;
    negativeExposure: boolean;
    capViolations: number;
    haircutViolations: number;
  };

  response: {
    avgCashIncrease: number;
    avgRiskReduction: number;
    avgScenarioProb: { BASE: number; RISK: number; TAIL: number };
  };

  samples: {
    asOf: string;
    scenario: string;
    allocations: { spx: number; btc: number; cash: number };
    overrideIntensity: number;
    warnings: string[];
  }[];

  verdict: {
    resilient: boolean;
    issues: string[];
  };
}

export interface CrashTestReport {
  totalSteps: number;
  numericalErrors: number;
  regimeFlips: number;
  overrideExplosions: number;
  nanCount: number;
  capViolations: number;
  determinismFail: boolean;
  flipStorm: boolean;
  resilienceScore: number;

  byMode: Record<string, {
    steps: number;
    nanCount: number;
    flipCount: number;
    maxOverride: number;
    capViolations: number;
    issues: string[];
  }>;

  verdict: {
    grade: 'PRODUCTION' | 'INSTITUTIONAL' | 'REVIEW' | 'FAIL';
    score: number;
    reasons: string[];
  };
}
