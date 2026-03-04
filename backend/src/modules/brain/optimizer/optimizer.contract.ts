/**
 * P11 — Capital Allocation Optimizer Contract
 * 
 * Optimizer is a WRAPPER, not a replacement for Brain.
 * Small deltas only, maximum safety, always explainable.
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type OptimizerMode = 'off' | 'preview' | 'on';
export type Posture = 'OFFENSIVE' | 'NEUTRAL' | 'DEFENSIVE';
export type Scenario = 'BASE' | 'RISK' | 'TAIL';

export interface OptimizerInput {
  asOf: string;
  allocations: { spx: number; btc: number; cash: number };
  posture: Posture;
  scenario: Scenario;
  crossAssetRegime: string;
  contagionScore: number;
  
  forecasts: {
    spx: { mean: number; q05: number; tailRisk: number };
    btc: { mean: number; q05: number; tailRisk: number };
  };
}

export interface AssetRationale {
  expectedTilt: number;
  tailPenalty: number;
  corrPenalty: number;
  guardPenalty: number;
  score: number;
}

export interface OptimizerOutput {
  mode: OptimizerMode;
  asOf: string;
  maxDeltaAllowed: number;
  deltas: { spx: number; btc: number; cash: number };
  final: { spx: number; btc: number; cash: number };
  rationale: {
    spx: AssetRationale;
    btc: AssetRationale;
  };
  constraints: {
    tailClampApplied: boolean;
    riskOffSyncApplied: boolean;
    defensiveCapApplied: boolean;
  };
  applied: boolean;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS (Tunable)
// ═══════════════════════════════════════════════════════════════

export const OPTIMIZER_PARAMS = {
  // Score → Delta conversion factor
  K: 0.30,
  
  // Component weights
  W_RETURN: 1.00,     // Expected return contribution
  W_TAIL: 1.20,       // Tail risk penalty weight
  W_CORR: 0.80,       // Contagion/correlation penalty
  W_GUARD: 0.60,      // Defensive posture penalty
  
  // Delta caps
  MAX_DELTA_BASE: 0.15,        // Normal max delta
  MAX_DELTA_DEFENSIVE: 0.08,   // Defensive posture cap
  MAX_DELTA_TAIL: 0.10,        // TAIL scenario cap (risk-down only)
  
  // Minimum cash floor
  MIN_CASH: 0.05,
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateOptimizerOutput(out: OptimizerOutput): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // No NaN
  const values = [
    out.deltas.spx, out.deltas.btc, out.deltas.cash,
    out.final.spx, out.final.btc, out.final.cash,
  ];
  if (values.some(v => isNaN(v) || !isFinite(v))) {
    errors.push('NaN or Infinite value detected');
  }
  
  // Sum = 1
  const sum = out.final.spx + out.final.btc + out.final.cash;
  if (Math.abs(sum - 1) > 0.01) {
    errors.push(`Final allocations sum to ${sum}, expected ~1`);
  }
  
  // Delta within cap
  const maxDelta = Math.max(Math.abs(out.deltas.spx), Math.abs(out.deltas.btc));
  if (maxDelta > out.maxDeltaAllowed + 0.001) {
    errors.push(`Delta ${maxDelta} exceeds cap ${out.maxDeltaAllowed}`);
  }
  
  // Non-negative allocations
  if (out.final.spx < -0.001 || out.final.btc < -0.001 || out.final.cash < -0.001) {
    errors.push('Negative allocation detected');
  }
  
  return { valid: errors.length === 0, errors };
}
