/**
 * Continuity Rule
 * 
 * Checks for gaps in window sequence.
 * If more than 1 window is missing → REJECTED
 * 
 * Pure function, no side effects.
 */
import type { RuleContext, RulePenalty } from '../approval.types.js';
import { RULE_NAMES } from '../approval.types.js';
import { WINDOW_DURATIONS_MS } from '../../services/window_calculator.js';

export function evaluateContinuityRule(context: RuleContext): RulePenalty | null {
  const { currentWindow, previousWindow } = context;
  
  // No previous window = first window, skip continuity check
  if (!previousWindow) {
    return null;
  }
  
  const windowDuration = WINDOW_DURATIONS_MS[currentWindow.window];
  const expectedStart = new Date(previousWindow.windowEnd.getTime());
  const actualStart = currentWindow.windowStart;
  
  // Calculate gap
  const gapMs = actualStart.getTime() - expectedStart.getTime();
  const gapWindows = Math.floor(gapMs / windowDuration);
  
  // If gap > 1 window → penalty
  if (gapWindows > 1) {
    return {
      rule: RULE_NAMES.CONTINUITY,
      penalty: 60, // Severe penalty, will likely cause REJECTED
      reason: `Gap of ${gapWindows} windows detected (expected continuous sequence)`,
    };
  }
  
  // If gap = 1 window → minor penalty (might be acceptable)
  if (gapWindows === 1) {
    return {
      rule: RULE_NAMES.CONTINUITY,
      penalty: 15,
      reason: `Gap of 1 window detected (possible data delay)`,
    };
  }
  
  return null;
}
