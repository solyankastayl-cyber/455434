/**
 * BLOCK 1.5.1 — Alt ML Types
 * ===========================
 * Types for ML-based alt screener.
 */

export type AltMlLabel = 1 | 0;  // 1 = WINNER, 0 = NOT_WINNER

export interface AltMlSample {
  symbol: string;
  ts: number;
  horizon: '1h' | '4h' | '24h';
  features: number[];       // normalized vector (len = N)
  label: AltMlLabel;
  futureReturn: number;     // for metrics
  fundingLabel: string;     // funding context
}

export interface AltMlModel {
  version: string;
  trainedAt: number;
  horizon: '1h' | '4h' | '24h';
  featureCount: number;

  // Logistic regression weights
  weights: number[];        // len = featureCount
  bias: number;

  // Training stats
  trainingSamples: number;
  accuracy: number;
  winnerRate: number;

  // Calibration (optional)
  calibration?: {
    a: number;
    b: number;
  };
}

export interface AltMlPrediction {
  symbol: string;
  pWinner: number;          // 0..1 probability
  score: number;            // 0..100
  confidence: number;       // 0..1

  // Explainability
  topContributions: Array<{
    feature: string;
    value: number;
    contribution: number;
  }>;
}

console.log('[Screener ML] Types loaded');
