/**
 * P9.2 — Brain Simulation Contract
 */

export interface BrainSimRunRequest {
  asset: 'dxy' | 'spx' | 'btc';
  start: string;
  end: string;
  stepDays: number;
  horizons: Array<30 | 90 | 180 | 365>;
  mode: 'compare' | 'brain_only';
  seed?: number;
}

export interface SimSample {
  asOf: string;
  compare: {
    scenario: string;
    delta: { spx: number; btc: number; cash: number };
    severity: string;
    reasons: string[];
    crossAssetLabel?: string;
  };
  realized: Record<string, { horizon: number; return: number }>;
}

export interface BrainSimReport {
  id: string;
  asset: string;
  window: { start: string; end: string; stepDays: number; nSteps: number };
  horizons: number[];

  metrics: {
    hitRate_off: Record<string, number>;
    hitRate_on: Record<string, number>;
    deltaPp: Record<string, number>;
    avgExposure_off: { spx: number; btc: number; cash: number };
    avgExposure_on: { spx: number; btc: number; cash: number };
    brainFlipRate: number;
    avgOverrideIntensity: number;
    maxOverrideIntensity: number;
    pnlProxy?: {
      maxDD_off: number;
      maxDD_on: number;
      vol_off: number;
      vol_on: number;
      sharpe_off?: number;
      sharpe_on?: number;
    };
  };

  samples: SimSample[];

  verdict: {
    ready: boolean;
    reasons: string[];
    gates: Record<string, { pass: boolean; value: number; threshold: number }>;
  };
}
