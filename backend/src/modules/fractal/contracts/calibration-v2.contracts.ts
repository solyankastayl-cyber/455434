/**
 * BLOCK 38.6 — Calibration V2 Contracts (Beta-Binomial)
 * 
 * Bayesian calibration with Beta-Binomial model per bucket:
 * - Prior: Beta(a0, b0)
 * - Posterior: Beta(a0 + wins, b0 + losses)
 * - posterior mean = (wins + a0) / (n + a0 + b0)
 */

export interface CalibrationV2Config {
  buckets: number;           // 20
  priorA: number;            // 1 (uniform prior)
  priorB: number;            // 1
  minSamplesForUse: number;  // 60
  emaAlpha?: number;         // optional smoothing (0.1)
}

export interface BucketStats {
  i: number;                 // bucket index
  lo: number;                // inclusive lower bound
  hi: number;                // exclusive upper bound
  n: number;                 // total observations
  k: number;                 // wins (correct predictions)
  mean: number;              // posterior mean (calibrated probability)
  q05?: number;              // 5th percentile (credible interval)
  q95?: number;              // 95th percentile
  meanEma?: number;          // EMA-smoothed mean
}

export interface CalibrationSnapshot {
  symbol: string;
  horizonDays: number;
  asOfTs: number;
  config: CalibrationV2Config;
  buckets: BucketStats[];
  totalN: number;
  ece: number;               // Expected Calibration Error
  isUsable: boolean;         // totalN >= minSamplesForUse
}

export const DEFAULT_CALIBRATION_V2_CONFIG: CalibrationV2Config = {
  buckets: 20,
  priorA: 1,
  priorB: 1,
  minSamplesForUse: 60,
  emaAlpha: 0.1,
};

/**
 * BLOCK 38.7 — Confidence Floor by effectiveN
 * 
 * High confidence cannot be achieved with low effectiveN,
 * even if bucket posterior is high.
 */
export interface ConfidenceFloorConfig {
  enabled: boolean;
  
  // Floor curve: maxConf = 1 - exp(-effectiveN / n0)
  n0: number;                // 10
  
  // Hard floors
  floors: Array<{
    minEffectiveN: number;
    maxConfidence: number;
  }>;
}

export const DEFAULT_CONFIDENCE_FLOOR_CONFIG: ConfidenceFloorConfig = {
  enabled: true,
  n0: 10,
  floors: [
    { minEffectiveN: 0, maxConfidence: 0.35 },
    { minEffectiveN: 3, maxConfidence: 0.50 },
    { minEffectiveN: 6, maxConfidence: 0.65 },
    { minEffectiveN: 10, maxConfidence: 0.80 },
    { minEffectiveN: 15, maxConfidence: 0.90 },
    { minEffectiveN: 25, maxConfidence: 1.00 },
  ],
};
