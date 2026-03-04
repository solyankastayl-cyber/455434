/**
 * BLOCK 38.1 — Reliability Service
 * 
 * Internal self-diagnosis for Fractal module.
 * Computes reliability ∈ [0,1] based on:
 * - Drift health
 * - Calibration health (ECE)
 * - Rolling validation pass rate
 * - MC tail risk (P95 DD, P10 Sharpe)
 */

import {
  ReliabilityConfig,
  ReliabilityInputs,
  ReliabilityResult,
  ReliabilityBadge,
  DEFAULT_RELIABILITY_CONFIG,
} from '../contracts/reliability.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function lerp01(x: number, good: number, bad: number): number {
  if (good === bad) return 0;
  const t = (x - bad) / (good - bad);
  return clamp01(t);
}

function weightedMean(parts: Array<{ w: number; v: number }>): number {
  const sw = parts.reduce((s, p) => s + p.w, 0);
  if (sw <= 0) return 0;
  return parts.reduce((s, p) => s + p.w * p.v, 0) / sw;
}

// ═══════════════════════════════════════════════════════════════
// Component Health Computations
// ═══════════════════════════════════════════════════════════════

function computeDriftHealth(
  driftLevel: ReliabilityInputs['driftLevel'],
  cfg: ReliabilityConfig
): number {
  return clamp01(cfg.driftMap[driftLevel] ?? 0.5);
}

function computeCalibrationHealth(
  ece: number | undefined,
  n: number | undefined,
  cfg: ReliabilityConfig,
  notes: string[]
): number {
  if (typeof ece !== 'number' || typeof n !== 'number') {
    notes.push('calibration_missing');
    return 0.6; // neutral default
  }

  if (n < cfg.calibration.minN) {
    notes.push('calibration_low_sample');
    return 0.55; // don't trust too much
  }

  // Lower ECE is better: eceBad => 0, eceGood => 1
  const health = lerp01(
    cfg.calibration.eceBad - ece,
    cfg.calibration.eceBad - cfg.calibration.eceGood,
    0
  );
  
  return clamp01(health);
}

function computeRollingHealth(
  passRate: number | undefined,
  worstSharpe: number | undefined,
  cfg: ReliabilityConfig,
  notes: string[]
): number {
  if (typeof passRate !== 'number' || typeof worstSharpe !== 'number') {
    notes.push('rolling_missing');
    return 0.6;
  }

  const passScore = lerp01(passRate, cfg.rolling.passGood, cfg.rolling.passBad);
  const worstScore = lerp01(worstSharpe, cfg.rolling.worstSharpeGood, cfg.rolling.worstSharpeBad);
  
  return clamp01(0.65 * passScore + 0.35 * worstScore);
}

function computeTailRiskHealth(
  p95MaxDD: number | undefined,
  p10Sharpe: number | undefined,
  cfg: ReliabilityConfig,
  notes: string[]
): number {
  if (typeof p95MaxDD !== 'number' || typeof p10Sharpe !== 'number') {
    notes.push('mc_missing');
    return 0.6;
  }

  // Lower DD is better: p95DdBad => 0, p95DdGood => 1
  const ddScore = lerp01(
    cfg.tail.p95DdBad - p95MaxDD,
    cfg.tail.p95DdBad - cfg.tail.p95DdGood,
    0
  );
  
  const shScore = lerp01(p10Sharpe, cfg.tail.p10SharpeGood, cfg.tail.p10SharpeBad);
  
  return clamp01(0.70 * ddScore + 0.30 * shScore);
}

// ═══════════════════════════════════════════════════════════════
// Main Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute Fractal reliability score
 * 
 * @param inputs - Current health metrics from various systems
 * @param cfg - Reliability configuration with weights and thresholds
 */
export function computeReliability(
  inputs: ReliabilityInputs,
  cfg: ReliabilityConfig = DEFAULT_RELIABILITY_CONFIG
): ReliabilityResult {
  const notes: string[] = [];

  // 1) Drift health
  const driftHealth = computeDriftHealth(inputs.driftLevel, cfg);

  // 2) Calibration health
  const calibrationHealth = computeCalibrationHealth(
    inputs.calibrationEce,
    inputs.calibrationN,
    cfg,
    notes
  );

  // 3) Rolling validation health
  const rollingHealth = computeRollingHealth(
    inputs.rollingPassRate,
    inputs.rollingWorstSharpe,
    cfg,
    notes
  );

  // 4) Tail risk health (MC)
  const tailRiskHealth = computeTailRiskHealth(
    inputs.mcP95MaxDD,
    inputs.mcP10Sharpe,
    cfg,
    notes
  );

  // Aggregate reliability score
  const reliability = clamp01(weightedMean([
    { w: cfg.weights.drift, v: driftHealth },
    { w: cfg.weights.calibration, v: calibrationHealth },
    { w: cfg.weights.rolling, v: rollingHealth },
    { w: cfg.weights.tail, v: tailRiskHealth },
  ]));

  // Determine badge
  const badge: ReliabilityBadge =
    reliability >= cfg.badgeThresholds.ok ? 'OK' :
    reliability >= cfg.badgeThresholds.warn ? 'WARN' :
    reliability >= cfg.badgeThresholds.degraded ? 'DEGRADED' : 'CRITICAL';

  return {
    reliability,
    badge,
    components: {
      driftHealth,
      calibrationHealth,
      rollingHealth,
      tailRiskHealth,
    },
    inputs,
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// Reliability Snapshot Builder
// ═══════════════════════════════════════════════════════════════

export interface ReliabilitySnapshotDeps {
  getDriftLevel: () => Promise<'OK' | 'WARN' | 'DEGRADED' | 'CRITICAL'>;
  getCalibrationMetrics: () => Promise<{ ece?: number; n?: number }>;
  getRollingMetrics: () => Promise<{ passRate?: number; worstSharpe?: number }>;
  getMcDailyMetrics: () => Promise<{ p95MaxDD?: number; p10Sharpe?: number }>;
}

/**
 * Build reliability inputs from current system state
 */
export async function buildReliabilityInputs(
  deps: ReliabilitySnapshotDeps
): Promise<ReliabilityInputs> {
  const [driftLevel, cal, rolling, mc] = await Promise.all([
    deps.getDriftLevel().catch(() => 'OK' as const),
    deps.getCalibrationMetrics().catch(() => ({})),
    deps.getRollingMetrics().catch(() => ({})),
    deps.getMcDailyMetrics().catch(() => ({})),
  ]);

  return {
    driftLevel,
    calibrationEce: cal.ece,
    calibrationN: cal.n,
    rollingPassRate: rolling.passRate,
    rollingWorstSharpe: rolling.worstSharpe,
    mcP95MaxDD: mc.p95MaxDD,
    mcP10Sharpe: mc.p10Sharpe,
  };
}

// ═══════════════════════════════════════════════════════════════
// Quick Reliability Check (for use in signal path)
// ═══════════════════════════════════════════════════════════════

/**
 * Quick reliability check with defaults
 * For use when full inputs aren't available
 */
export function quickReliabilityCheck(
  driftLevel: ReliabilityInputs['driftLevel'] = 'OK',
  mcP95MaxDD?: number
): ReliabilityResult {
  const inputs: ReliabilityInputs = {
    driftLevel,
    mcP95MaxDD,
  };
  return computeReliability(inputs);
}

/**
 * Apply reliability modifier to confidence
 * confidenceFinal = confidence * (0.4 + 0.6 * reliability)
 */
export function applyReliabilityModifier(
  confidence: number,
  reliability: number
): number {
  return confidence * (0.4 + 0.6 * clamp01(reliability));
}
