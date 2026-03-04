/**
 * P10.1 — Regime Memory State Contract
 * 
 * Tracks duration and stability of regimes for meta-risk calculation.
 * Three scopes: macro, guard, crossAsset
 */

// ═══════════════════════════════════════════════════════════════
// SCOPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export type RegimeScope = 'macro' | 'guard' | 'crossAsset';

export type MacroRegimeValue = 
  | 'EASING' 
  | 'TIGHTENING' 
  | 'STRESS' 
  | 'NEUTRAL' 
  | 'NEUTRAL_MIXED' 
  | 'RISK_ON' 
  | 'RISK_OFF';

export type GuardLevelValue = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';

export type CrossAssetRegimeValue = 
  | 'RISK_ON_SYNC' 
  | 'RISK_OFF_SYNC' 
  | 'FLIGHT_TO_QUALITY' 
  | 'DECOUPLED' 
  | 'MIXED';

// ═══════════════════════════════════════════════════════════════
// STATE CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface RegimeMemoryState {
  scope: RegimeScope;
  current: string;                // e.g. "EASING", "WARN", "RISK_ON_SYNC"
  since: string;                  // ISO date when this regime started
  daysInState: number;            // how many days in current state
  flips30d: number;               // regime changes in last 30 days
  stability: number;              // 0..1 (low flips + high persistence)
  lastUpdated: string;            // last computation timestamp
  previousStates: {               // last 5 states for context
    value: string;
    since: string;
    until: string;
    days: number;
  }[];
}

export interface RegimeMemoryPack {
  asOf: string;
  macro: RegimeMemoryState;
  guard: RegimeMemoryState;
  crossAsset: RegimeMemoryState;
  meta: {
    generatedAt: string;
    inputsHash: string;           // for determinism verification
  };
}

// ═══════════════════════════════════════════════════════════════
// TIMELINE CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface RegimeTimelinePoint {
  asOf: string;
  macro: { value: string; daysInState: number; stability: number };
  guard: { value: string; daysInState: number; stability: number };
  crossAsset: { value: string; daysInState: number; stability: number };
}

export interface RegimeTimelinePack {
  start: string;
  end: string;
  stepDays: number;
  points: RegimeTimelinePoint[];
  summary: {
    macroFlips: number;
    guardFlips: number;
    crossAssetFlips: number;
    avgMacroStability: number;
    avgGuardStability: number;
    avgCrossAssetStability: number;
    dominantMacro: string;
    dominantGuard: string;
    dominantCrossAsset: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// STABILITY CALCULATION PARAMETERS
// ═══════════════════════════════════════════════════════════════

export const STABILITY_PARAMS = {
  // Days in state contribution (capped at 90 days)
  DURATION_WEIGHT: 0.5,
  DURATION_CAP_DAYS: 90,
  
  // Flip penalty (0 flips = full score, 10+ flips = 0)
  FLIP_WEIGHT: 0.5,
  FLIP_CAP: 10,
  
  // Lookback for flip counting
  FLIP_LOOKBACK_DAYS: 30,
};

/**
 * Calculate stability score from duration and flips
 * stability = 0.5 * (daysInState/90) + 0.5 * (1 - flips30d/10)
 * Clamped to [0, 1]
 */
export function computeStability(daysInState: number, flips30d: number): number {
  const { DURATION_WEIGHT, DURATION_CAP_DAYS, FLIP_WEIGHT, FLIP_CAP } = STABILITY_PARAMS;
  
  const durationScore = Math.min(daysInState / DURATION_CAP_DAYS, 1);
  const flipScore = Math.max(0, 1 - (flips30d / FLIP_CAP));
  
  const raw = DURATION_WEIGHT * durationScore + FLIP_WEIGHT * flipScore;
  return Math.round(raw * 1000) / 1000; // 3 decimal places
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateRegimeMemoryPack(pack: RegimeMemoryPack): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!pack.asOf) errors.push('Missing asOf');
  
  for (const scope of ['macro', 'guard', 'crossAsset'] as RegimeScope[]) {
    const state = pack[scope];
    if (!state) {
      errors.push(`Missing ${scope} state`);
      continue;
    }
    if (!state.current) errors.push(`Missing ${scope}.current`);
    if (!state.since) errors.push(`Missing ${scope}.since`);
    if (state.daysInState < 0) errors.push(`Invalid ${scope}.daysInState`);
    if (state.flips30d < 0) errors.push(`Invalid ${scope}.flips30d`);
    if (state.stability < 0 || state.stability > 1) errors.push(`Invalid ${scope}.stability`);
  }
  
  return { valid: errors.length === 0, errors };
}
