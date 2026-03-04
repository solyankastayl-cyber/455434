/**
 * GUARD HYSTERESIS RULES — P1.3
 * 
 * Fixed thresholds and pure functions for guard level determination.
 * All logic is deterministic and stateless (state managed separately).
 * 
 * RULES:
 * - Enter thresholds are HIGHER than exit (asymmetric)
 * - Minimum hold periods prevent rapid oscillation
 * - Cooldown after BLOCK prevents immediate re-entry
 */

import type { 
  GuardLevel, 
  GuardInputs, 
  LevelThresholds,
  GUARD_LEVEL_ORDER 
} from './guard_hysteresis.contract.js';

// ═══════════════════════════════════════════════════════════════
// FIXED THRESHOLDS
// ═══════════════════════════════════════════════════════════════

export const THRESHOLDS: Record<GuardLevel, LevelThresholds> = {
  BLOCK: {
    enter: { creditMin: 0.50, vixMin: 32 },
    exit: { creditMax: 0.42, vixMax: 26 },
    minHoldDays: 21,
    cooldownDays: 14,
  },
  CRISIS: {
    enter: { creditMin: 0.25, vixMin: 18 },
    exit: { creditMax: 0.20, vixMax: 16 },
    minHoldDays: 21,
  },
  WARN: {
    enter: { creditMin: 0.30, macroMin: 0.15 },
    exit: { creditMax: 0.26, macroMax: 0.10 },
    minHoldDays: 14,
  },
  NONE: {
    enter: { creditMin: 0 },
    exit: { creditMax: 1 },
    minHoldDays: 0,
  },
};

export const LEVEL_ORDER: Record<GuardLevel, number> = {
  NONE: 0,
  WARN: 1,
  CRISIS: 2,
  BLOCK: 3,
};

// ═══════════════════════════════════════════════════════════════
// RAW LEVEL CALCULATION (no hysteresis)
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate raw guard level from inputs (no hysteresis).
 * Uses ENTER thresholds only.
 */
export function calculateRawLevel(inputs: GuardInputs): GuardLevel {
  const { creditComposite, vix, macroScoreSigned } = inputs;
  
  // BLOCK: credit >= 0.50 AND vix >= 32
  if (creditComposite >= THRESHOLDS.BLOCK.enter.creditMin &&
      vix >= (THRESHOLDS.BLOCK.enter.vixMin ?? 0)) {
    return 'BLOCK';
  }
  
  // CRISIS: credit >= 0.25 AND vix >= 18
  if (creditComposite >= THRESHOLDS.CRISIS.enter.creditMin &&
      vix >= (THRESHOLDS.CRISIS.enter.vixMin ?? 0)) {
    return 'CRISIS';
  }
  
  // WARN: credit >= 0.30 AND macroScoreSigned >= 0.15
  if (creditComposite >= THRESHOLDS.WARN.enter.creditMin &&
      macroScoreSigned >= (THRESHOLDS.WARN.enter.macroMin ?? -1)) {
    return 'WARN';
  }
  
  return 'NONE';
}

// ═══════════════════════════════════════════════════════════════
// EXIT CONDITION CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check if exit condition is met for current level.
 * Uses EXIT thresholds (more lenient than enter).
 */
export function checkExitCondition(
  currentLevel: GuardLevel,
  inputs: GuardInputs
): boolean {
  if (currentLevel === 'NONE') return false;
  
  const threshold = THRESHOLDS[currentLevel];
  const { creditComposite, vix, macroScoreSigned } = inputs;
  
  switch (currentLevel) {
    case 'BLOCK':
      // Exit if credit < 0.42 OR vix < 26
      return creditComposite < threshold.exit.creditMax ||
             vix < (threshold.exit.vixMax ?? 0);
    
    case 'CRISIS':
      // Exit if credit < 0.20 OR vix < 16
      return creditComposite < threshold.exit.creditMax ||
             vix < (threshold.exit.vixMax ?? 0);
    
    case 'WARN':
      // Exit if credit < 0.26 OR macroScoreSigned < 0.10
      return creditComposite < threshold.exit.creditMax ||
             macroScoreSigned < (threshold.exit.macroMax ?? -1);
    
    default:
      return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// HYSTERESIS STATE MACHINE
// ═══════════════════════════════════════════════════════════════

export interface HysteresisState {
  level: GuardLevel;
  stateSince: string;
  cooldownUntil: string | null;
}

export interface HysteresisResult {
  newLevel: GuardLevel;
  rawLevel: GuardLevel;
  stateSince: string;
  cooldownUntil: string | null;
  enterThresholdHit: boolean;
  exitThresholdHit: boolean;
  minHoldActive: boolean;
  cooldownActive: boolean;
}

/**
 * Calculate next guard level with hysteresis.
 * 
 * Algorithm:
 * 1. Compute rawLevel from enter conditions
 * 2. If rawLevel > currentLevel → promote immediately
 * 3. If rawLevel < currentLevel:
 *    - If daysInState < minHold → keep current
 *    - Else if exitCondition met → downgrade to rawLevel
 * 4. If exiting BLOCK → set cooldown
 * 5. If cooldown active → prevent re-entering BLOCK
 */
export function applyHysteresis(
  inputs: GuardInputs,
  prevState: HysteresisState
): HysteresisResult {
  const rawLevel = calculateRawLevel(inputs);
  const currentLevel = prevState.level;
  const currentOrder = LEVEL_ORDER[currentLevel];
  const rawOrder = LEVEL_ORDER[rawLevel];
  
  // Calculate days in current state
  const stateSinceDate = new Date(prevState.stateSince);
  const asOfDate = new Date(inputs.asOf);
  const daysInState = Math.floor((asOfDate.getTime() - stateSinceDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Check cooldown
  let cooldownActive = false;
  if (prevState.cooldownUntil) {
    const cooldownDate = new Date(prevState.cooldownUntil);
    cooldownActive = asOfDate < cooldownDate;
  }
  
  let newLevel = currentLevel;
  let newStateSince = prevState.stateSince;
  let newCooldownUntil = prevState.cooldownUntil;
  let enterThresholdHit = false;
  let exitThresholdHit = false;
  let minHoldActive = false;
  
  // CASE 1: rawLevel HIGHER than current → promote immediately
  if (rawOrder > currentOrder) {
    // Exception: if cooldown active, cannot re-enter BLOCK
    if (rawLevel === 'BLOCK' && cooldownActive) {
      newLevel = 'CRISIS'; // Cap at CRISIS during cooldown
    } else {
      newLevel = rawLevel;
      newStateSince = inputs.asOf;
      enterThresholdHit = true;
    }
  }
  // CASE 2: rawLevel LOWER than current → check minHold and exit
  else if (rawOrder < currentOrder) {
    const minHold = THRESHOLDS[currentLevel].minHoldDays;
    
    if (daysInState < minHold) {
      // Keep current level (minHold not reached)
      minHoldActive = true;
    } else {
      // Check exit condition
      const canExit = checkExitCondition(currentLevel, inputs);
      if (canExit) {
        // Exiting BLOCK → set cooldown
        if (currentLevel === 'BLOCK') {
          const cooldownDays = THRESHOLDS.BLOCK.cooldownDays ?? 14;
          const cooldownEnd = new Date(asOfDate);
          cooldownEnd.setDate(cooldownEnd.getDate() + cooldownDays);
          newCooldownUntil = cooldownEnd.toISOString().split('T')[0];
        }
        
        newLevel = rawLevel;
        newStateSince = inputs.asOf;
        exitThresholdHit = true;
      }
    }
  }
  // CASE 3: Same level → no change
  
  return {
    newLevel,
    rawLevel,
    stateSince: newStateSince,
    cooldownUntil: newCooldownUntil,
    enterThresholdHit,
    exitThresholdHit,
    minHoldActive,
    cooldownActive,
  };
}

// ═══════════════════════════════════════════════════════════════
// LEVEL UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Check if level is stress (CRISIS or BLOCK).
 */
export function isStressLevel(level: GuardLevel): boolean {
  return level === 'CRISIS' || level === 'BLOCK';
}

/**
 * Get minimum hold days for level.
 */
export function getMinHoldDays(level: GuardLevel): number {
  return THRESHOLDS[level].minHoldDays;
}
