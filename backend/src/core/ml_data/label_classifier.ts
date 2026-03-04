/**
 * Label Classifier
 * 
 * Classifies price returns into UP/DOWN/FLAT labels
 */

export type OutcomeLabel = 'UP' | 'DOWN' | 'FLAT';
export type Horizon = '1h' | '6h' | '24h' | '72h' | '7d';

// FLAT thresholds per horizon
const FLAT_THRESHOLDS: Record<Horizon, number> = {
  '1h': 0.20,
  '6h': 0.50,
  '24h': 1.00,
  '72h': 1.50,
  '7d': 2.00,
};

// Horizon durations in milliseconds
export const HORIZON_MS: Record<Horizon, number> = {
  '1h': 1 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '72h': 72 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/**
 * Calculate return percentage
 */
export function calcReturnPct(price0: number, price1: number): number {
  if (price0 <= 0) return 0;
  return ((price1 / price0) - 1) * 100;
}

/**
 * Classify return into UP/DOWN/FLAT
 */
export function classifyReturn(retPct: number, horizon: Horizon): OutcomeLabel {
  const threshold = FLAT_THRESHOLDS[horizon] ?? 1.0;
  
  if (retPct > threshold) return 'UP';
  if (retPct < -threshold) return 'DOWN';
  return 'FLAT';
}

/**
 * Check if horizon has passed since t0
 */
export function isHorizonReached(t0: Date, horizon: Horizon, now = new Date()): boolean {
  const elapsed = now.getTime() - t0.getTime();
  return elapsed >= HORIZON_MS[horizon];
}

/**
 * Get target time for horizon
 */
export function getHorizonTime(t0: Date, horizon: Horizon): Date {
  return new Date(t0.getTime() + HORIZON_MS[horizon]);
}
