/**
 * BLOCK 38.4 — Calibration Quality Contracts
 * 
 * Metrics for confidence calibration quality:
 * - ECE (Expected Calibration Error)
 * - Brier Score
 * - Reliability curve data
 */

export type CalibrationQualityBadge =
  | 'OK'
  | 'WARN'
  | 'DEGRADED'
  | 'CRITICAL'
  | 'INSUFFICIENT_DATA';

export interface CalibrationBin {
  idx: number;
  n: number;
  pAvg: number;       // average predicted confidence
  hitRate: number;    // actual success rate
  gap: number;        // hitRate - pAvg
  pMin: number;
  pMax: number;
}

export interface CalibrationQualityReport {
  sampleN: number;
  ece: number;                     // Expected Calibration Error [0,1]
  brier: number;                   // Brier Score [0,1]
  badge: CalibrationQualityBadge;
  bins: CalibrationBin[];
  monotonicityViolations: number;  // where hitRate drops as confidence rises
  coverage: {
    above60: number;               // % signals with conf > 0.6
    above70: number;
    above80: number;
  };
  updatedAtTs: number;
}

export interface CalibrationQualityConfig {
  // Badge thresholds
  eceOk: number;           // 0.05
  eceWarn: number;         // 0.08
  eceDegraded: number;     // 0.12
  
  brierOk: number;         // 0.23
  brierWarn: number;       // 0.26
  brierDegraded: number;   // 0.30
  
  minSamples: number;      // 80
  numBins: number;         // 10
}

export const DEFAULT_CALIBRATION_QUALITY_CONFIG: CalibrationQualityConfig = {
  eceOk: 0.05,
  eceWarn: 0.08,
  eceDegraded: 0.12,
  brierOk: 0.23,
  brierWarn: 0.26,
  brierDegraded: 0.30,
  minSamples: 80,
  numBins: 10,
};
