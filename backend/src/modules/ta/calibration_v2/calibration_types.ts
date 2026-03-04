/**
 * Phase I: Calibration v2 Types
 * 
 * Per-regime calibration with binned reliability curves
 */

import { MarketRegime, VolRegime } from '../regime/regime_types.js';

// Regime bucket for calibration grouping
export type RegimeBucket = `${MarketRegime}_${VolRegime}`;

// Calibration model for a regime
export interface CalibrationModel {
  regime: RegimeBucket;
  bins: CalibrationBin[];
  sampleCount: number;
  winRate: number;
  ece: number;  // Expected Calibration Error
  generatedAt: Date;
}

// Single calibration bin
export interface CalibrationBin {
  minScore: number;
  maxScore: number;
  midScore: number;
  count: number;
  wins: number;
  winRate: number;
  calibratedP: number;  // After isotonic smoothing
}

// Raw data point for building calibration
export interface CalibrationDataPoint {
  runId: string;
  scenarioId: string;
  rawScore: number;
  outcome: 'WIN' | 'LOSS' | 'TIMEOUT' | 'NO_ENTRY';
  regime: RegimeBucket;
  patternTypes: string[];
  createdAt: Date;
}

// Calibration lookup result
export interface CalibrationResult {
  probability: number;
  source: 'CALIBRATED' | 'FALLBACK';
  regime: RegimeBucket | null;
  bin: CalibrationBin | null;
  sampleCount: number;
}

// Config for calibration building
export interface CalibrationConfig {
  binCount: number;             // Number of bins (default: 10)
  minSamplesPerBin: number;     // Minimum samples for valid bin (default: 5)
  minTotalSamples: number;      // Minimum total for valid model (default: 30)
  smoothingWindow: number;      // Isotonic smoothing window (default: 3)
  fallbackToGlobal: boolean;    // Use global model if regime has low samples
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  binCount: 10,
  minSamplesPerBin: 3,
  minTotalSamples: 10,
  smoothingWindow: 3,
  fallbackToGlobal: true,
};
