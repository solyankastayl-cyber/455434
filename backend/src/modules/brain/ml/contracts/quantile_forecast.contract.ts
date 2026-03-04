/**
 * P8.0-B — Quantile Forecast Contract
 * 
 * Response structure for /api/brain/v2/forecast endpoint.
 * Contains quantiles (q05, q50, q95, mean) and tailRisk per horizon.
 */

export const MODEL_VERSION = 'qv1_moe';
export const HORIZONS = ['30D', '90D', '180D', '365D'] as const;
export type Horizon = typeof HORIZONS[number];

// ═══════════════════════════════════════════════════════════════
// FORECAST CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface HorizonForecast {
  mean: number;
  q05: number;
  q50: number;
  q95: number;
  tailRisk: number; // 0..1
}

export interface RegimeProbabilities {
  EASING: number;
  TIGHTENING: number;
  STRESS: number;
  NEUTRAL: number;
  NEUTRAL_MIXED: number;
}

export interface ModelMeta {
  modelVersion: string;
  activeWeightsId: string | null;
  trainedAt: string | null;
  isBaseline: boolean;
}

export interface ForecastIntegrity {
  inputsHash: string;
  noLookahead: boolean;
  computeTimeMs: number;
}

export interface QuantileForecastResponse {
  asset: string;
  asOf: string;
  featuresVersion: string;
  model: ModelMeta;
  regime: {
    dominant: string;
    p: Partial<RegimeProbabilities>;
  };
  byHorizon: Record<Horizon, HorizonForecast>;
  integrity: ForecastIntegrity;
}

// ═══════════════════════════════════════════════════════════════
// TRAIN CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface TrainRequest {
  asset: string;
  start: string;
  end: string;
  step: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  horizons: Horizon[];
  quantiles: number[];
  regimeExperts: string[];
  minSamplesPerExpert: number;
  smoothing: number;
  seed: number;
}

export interface TrainResponse {
  ok: boolean;
  modelVersion: string;
  trainedAt: string;
  stats: {
    totalSamples: number;
    perExpert: Record<string, number>;
    droppedExperts: string[];
  };
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// STATUS CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface ForecastStatusResponse {
  asset: string;
  modelVersion: string;
  available: boolean;
  trainedAt: string | null;
  featuresVersion: string;
  isBaseline: boolean;
  coverage: Record<string, boolean>;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION & HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Ensure quantile monotonicity: q05 <= q50 <= q95
 */
export function enforceQuantileMonotonicity(
  q05: number,
  q50: number,
  q95: number
): [number, number, number] {
  const sorted = [q05, q50, q95].sort((a, b) => a - b);
  return [sorted[0], sorted[1], sorted[2]];
}

/**
 * Clamp return to reasonable bounds per horizon
 */
export function clampReturn(value: number, horizon: Horizon): number {
  const bounds: Record<Horizon, [number, number]> = {
    '30D': [-0.25, 0.25],
    '90D': [-0.40, 0.40],
    '180D': [-0.50, 0.50],
    '365D': [-0.60, 0.60],
  };
  const [min, max] = bounds[horizon];
  return Math.max(min, Math.min(max, value));
}

/**
 * Compute tailRisk from quantiles
 */
export function computeTailRisk(q05: number, q50: number, horizon: Horizon): number {
  const riskBand: Record<Horizon, number> = {
    '30D': 0.04,
    '90D': 0.08,
    '180D': 0.12,
    '365D': 0.18,
  };
  
  const spread = q50 - q05;
  const risk = spread / riskBand[horizon];
  return Math.max(0, Math.min(1, risk));
}

/**
 * Validate forecast response
 */
export function validateForecast(forecast: QuantileForecastResponse): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Check all horizons present
  for (const h of HORIZONS) {
    if (!forecast.byHorizon[h]) {
      errors.push(`Missing horizon: ${h}`);
      continue;
    }
    
    const hf = forecast.byHorizon[h];
    
    // Check finite values
    if (!isFinite(hf.mean)) errors.push(`${h}: mean not finite`);
    if (!isFinite(hf.q05)) errors.push(`${h}: q05 not finite`);
    if (!isFinite(hf.q50)) errors.push(`${h}: q50 not finite`);
    if (!isFinite(hf.q95)) errors.push(`${h}: q95 not finite`);
    
    // Check monotonicity
    if (hf.q05 > hf.q50 + 0.001) errors.push(`${h}: q05 > q50`);
    if (hf.q50 > hf.q95 + 0.001) errors.push(`${h}: q50 > q95`);
    
    // Check tailRisk range
    if (hf.tailRisk < 0 || hf.tailRisk > 1) {
      errors.push(`${h}: tailRisk out of [0,1]`);
    }
  }
  
  return { valid: errors.length === 0, errors };
}
