/**
 * GUARD HYSTERESIS CONTRACT — P1.3
 * 
 * Defines types for stateful guard with anti-flap logic.
 * 
 * Key Features:
 * - Enter/Exit thresholds (asymmetric to prevent oscillation)
 * - Minimum hold period per level
 * - Cooldown after BLOCK exit
 * 
 * @version GUARD_HYSTERESIS_V1.0
 */

// ═══════════════════════════════════════════════════════════════
// GUARD LEVELS
// ═══════════════════════════════════════════════════════════════

export type GuardLevel = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';

export const GUARD_LEVEL_ORDER: Record<GuardLevel, number> = {
  NONE: 0,
  WARN: 1,
  CRISIS: 2,
  BLOCK: 3,
};

// ═══════════════════════════════════════════════════════════════
// GUARD STATE
// ═══════════════════════════════════════════════════════════════

export interface GuardInputs {
  /** Credit composite score [0..1] */
  creditComposite: number;
  /** VIX level */
  vix: number;
  /** Macro score signed [-1..+1] */
  macroScoreSigned: number;
  /** As-of date */
  asOf: string;
}

export interface GuardState {
  /** Current guard level (with hysteresis) */
  level: GuardLevel;
  /** Raw level (without hysteresis) */
  rawLevel: GuardLevel;
  /** When current state started */
  stateSince: string;
  /** Cooldown end date (after BLOCK exit) */
  cooldownUntil: string | null;
  /** Days in current state */
  daysInState: number;
  /** Input values used */
  inputs: GuardInputs;
  /** Meta information */
  meta: {
    enterThresholdHit: boolean;
    exitThresholdHit: boolean;
    minHoldActive: boolean;
    cooldownActive: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLD CONFIG
// ═══════════════════════════════════════════════════════════════

export interface LevelThresholds {
  enter: {
    creditMin: number;
    vixMin?: number;
    macroMin?: number;
  };
  exit: {
    creditMax: number;
    vixMax?: number;
    macroMax?: number;
  };
  minHoldDays: number;
  cooldownDays?: number;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION RESULTS
// ═══════════════════════════════════════════════════════════════

export interface HysteresisValidation {
  ok: boolean;
  period: { from: string; to: string };
  metrics: {
    flipsPerYear: number;
    medianDurationDays: number;
    totalFlips: number;
    totalDays: number;
  };
  episodes: {
    gfcCoverage: number;      // GFC 2008-09: CRISIS+BLOCK %
    covidCoverage: number;    // COVID 2020: CRISIS+BLOCK %
    tighteningBlock: number;  // 2022: BLOCK %
    lowVolStress: number;     // 2017: CRISIS+BLOCK %
  };
  acceptance: {
    flipsOk: boolean;         // ≤4/year
    durationOk: boolean;      // median ≥30d
    gfcOk: boolean;           // ≥60%
    covidOk: boolean;         // ≥80%
    tighteningOk: boolean;    // ≤10%
    lowVolOk: boolean;        // ≤5%
  };
  passed: boolean;
}

// ═══════════════════════════════════════════════════════════════
// STORED STATE (MongoDB)
// ═══════════════════════════════════════════════════════════════

export interface StoredGuardState {
  _id?: any;
  env: string;
  level: GuardLevel;
  stateSince: string;
  cooldownUntil: string | null;
  lastRaw: GuardInputs;
  updatedAt: string;
}
