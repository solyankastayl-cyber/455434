/**
 * U1.3 - Driver Agreement Calculator
 * 
 * Calculates how much the A-F drivers agree with each other.
 * High agreement = more reliable signal.
 */
import type { SignalDriver, SignalState } from '../types/signal_driver.types.js';

// Bullish states
const BULLISH_STATES: SignalState[] = [
  'ACCUMULATION',
  'SUPPORT',
  'PERSISTENT',
  'ADDITION',
  'GROWING',
  'CONSOLIDATION',
  'ACTIVE',
];

// Bearish states
const BEARISH_STATES: SignalState[] = [
  'DISTRIBUTION',
  'RESISTANCE',
  'BREAKDOWN',
  'REMOVAL',
  'SHRINKING',
  'WEAK',
  'ALERT',
];

/**
 * Calculate driver agreement score (0..1)
 * 
 * High score = drivers mostly agree (all bullish or all bearish)
 * Low score = drivers are mixed/conflicting
 */
export function calculateDriverAgreement(
  drivers: Record<string, SignalDriver>
): number {
  const states = Object.values(drivers).map(d => d.state);
  
  if (states.length === 0) return 0;

  let bullishCount = 0;
  let bearishCount = 0;
  let neutralCount = 0;

  for (const state of states) {
    if (BULLISH_STATES.includes(state as SignalState)) {
      bullishCount++;
    } else if (BEARISH_STATES.includes(state as SignalState)) {
      bearishCount++;
    } else {
      neutralCount++;
    }
  }

  const total = states.length;
  const dominant = Math.max(bullishCount, bearishCount);
  
  // If most are neutral, it's actually low agreement (no clear direction)
  if (neutralCount > total / 2) {
    return 0.3;
  }

  // Agreement score = dominant direction / total non-neutral
  const nonNeutral = bullishCount + bearishCount;
  if (nonNeutral === 0) return 0.3;

  // Also penalize for conflicts (both bullish AND bearish present)
  const conflictPenalty = Math.min(bullishCount, bearishCount) > 0 ? 0.1 : 0;

  return Math.max(0, (dominant / total) - conflictPenalty);
}

/**
 * Get summary of driver agreement
 */
export function getDriverAgreementSummary(
  drivers: Record<string, SignalDriver>
): { bullish: number; bearish: number; neutral: number; dominant: 'BULLISH' | 'BEARISH' | 'MIXED' } {
  const states = Object.values(drivers).map(d => d.state);
  
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const state of states) {
    if (BULLISH_STATES.includes(state as SignalState)) {
      bullish++;
    } else if (BEARISH_STATES.includes(state as SignalState)) {
      bearish++;
    } else {
      neutral++;
    }
  }

  let dominant: 'BULLISH' | 'BEARISH' | 'MIXED' = 'MIXED';
  if (bullish > bearish + 1) dominant = 'BULLISH';
  if (bearish > bullish + 1) dominant = 'BEARISH';

  return { bullish, bearish, neutral, dominant };
}
