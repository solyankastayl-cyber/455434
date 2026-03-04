/**
 * BLOCK 38.1 — Reliability Contracts
 * 
 * Internal self-diagnosis: how "healthy" is Fractal right now?
 * Based on: drift, calibration, rolling validation, MC tail risk
 */

export type ReliabilityBadge = "OK" | "WARN" | "DEGRADED" | "CRITICAL";

export interface ReliabilityInputs {
  driftLevel: "OK" | "WARN" | "DEGRADED" | "CRITICAL";
  calibrationEce?: number;        // Expected Calibration Error (0..1)
  calibrationN?: number;          // sample count
  rollingPassRate?: number;       // 0..1
  rollingWorstSharpe?: number;    // can be negative
  mcP95MaxDD?: number;            // 0..1 (e.g. 0.428)
  mcP10Sharpe?: number;           // can be negative
}

export interface ReliabilityConfig {
  weights: {
    drift: number;        // 0.35
    calibration: number;  // 0.25
    rolling: number;      // 0.25
    tail: number;         // 0.15
  };

  // component gates
  driftMap: Record<"OK" | "WARN" | "DEGRADED" | "CRITICAL", number>;

  calibration: {
    minN: number;         // 200
    eceGood: number;      // 0.06
    eceBad: number;       // 0.15
  };

  rolling: {
    passGood: number;     // 0.80
    passBad: number;      // 0.55
    worstSharpeGood: number; // 0.10
    worstSharpeBad: number;  // -0.10
  };

  tail: {
    p95DdGood: number;    // 0.35
    p95DdBad: number;     // 0.50
    p10SharpeGood: number;// 0.25
    p10SharpeBad: number; // -0.05
  };

  badgeThresholds: {
    ok: number;           // >=0.75
    warn: number;         // >=0.55
    degraded: number;     // >=0.35
  };
}

export interface ReliabilityResult {
  reliability: number;    // 0..1
  badge: ReliabilityBadge;
  components: {
    driftHealth: number;
    calibrationHealth: number;
    rollingHealth: number;
    tailRiskHealth: number;
  };
  inputs?: ReliabilityInputs;
  notes?: string[];
}

export const DEFAULT_RELIABILITY_CONFIG: ReliabilityConfig = {
  weights: { drift: 0.35, calibration: 0.25, rolling: 0.25, tail: 0.15 },
  driftMap: { OK: 1.0, WARN: 0.70, DEGRADED: 0.40, CRITICAL: 0.15 },
  calibration: { minN: 200, eceGood: 0.06, eceBad: 0.15 },
  rolling: { passGood: 0.80, passBad: 0.55, worstSharpeGood: 0.10, worstSharpeBad: -0.10 },
  tail: { p95DdGood: 0.35, p95DdBad: 0.50, p10SharpeGood: 0.25, p10SharpeBad: -0.05 },
  badgeThresholds: { ok: 0.75, warn: 0.55, degraded: 0.35 },
};
