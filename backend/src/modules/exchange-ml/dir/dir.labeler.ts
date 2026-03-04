/**
 * Direction Labeler (ATR-Adjusted v2)
 * ====================================
 * 
 * ATR-adjusted labeling for direction prediction.
 * 
 * Key insight: Fixed percentage thresholds don't work across market regimes.
 * - In trending markets: 3.5% is "small"
 * - In flat markets: 3.5% is "huge"
 * 
 * Solution: Use ATR-based dynamic thresholds that adapt to volatility.
 * 
 * ATR multipliers by horizon:
 * - 1D:  win = 0.80 * ATR, neutral = 0.40 * ATR
 * - 7D:  win = 1.80 * ATR, neutral = 0.90 * ATR
 * - 30D: win = 3.20 * ATR, neutral = 1.60 * ATR
 */

import { DirLabel, Horizon, DIR_THRESHOLDS } from '../contracts/exchange.types.js';

// ═══════════════════════════════════════════════════════════════
// ATR-BASED THRESHOLD CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/**
 * ATR multipliers for each horizon.
 * These convert volatility (ATR%) into meaningful win/neutral thresholds.
 * 
 * CALIBRATED: Reduced from original values to ensure 30-45% signal coverage
 * (not 80%+ neutral which makes model useless for trading)
 */
const ATR_MULT: Record<Horizon, { win: number; neutral: number }> = {
  '1D':  { win: 0.50, neutral: 0.20 },  // Reduced from 0.80/0.40
  '7D':  { win: 1.00, neutral: 0.40 },  // Reduced from 1.80/0.90
  '30D': { win: 1.80, neutral: 0.70 },  // Reduced from 3.20/1.60
};

/**
 * Clamp value to range [min, max]
 */
function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Calculate dynamic thresholds based on ATR.
 * 
 * @param horizon - Forecast horizon (1D, 7D, 30D)
 * @param atrPct - ATR as percentage of price (e.g., 0.012 = 1.2%)
 * @returns { win, neutral } thresholds
 */
export function getDirThresholdsFromAtr(
  horizon: Horizon, 
  atrPct: number
): { win: number; neutral: number } {
  const m = ATR_MULT[horizon];

  // Guardrails: don't let threshold go absurd in flat/panic markets
  // ATR typically ranges from 0.3% (very flat) to 8% (crash/pump)
  const atr = clamp(0.003, 0.08, atrPct);
  
  // Calculate thresholds with additional guardrails
  const win = clamp(0.002, 0.12, m.win * atr);
  const neutral = clamp(0.001, 0.08, m.neutral * atr);

  return { win, neutral };
}

// ═══════════════════════════════════════════════════════════════
// MAIN LABELING FUNCTION (ATR-Adjusted)
// ═══════════════════════════════════════════════════════════════

/**
 * Label direction based on realized return, horizon, and ATR.
 * 
 * Uses ATR-adjusted thresholds when atrPct is provided,
 * falls back to fixed thresholds for backward compatibility.
 * 
 * @param horizon - Forecast horizon
 * @param realizedReturn - Actual return (e.g., +0.014 = +1.4%)
 * @param atrPct - Optional ATR as percentage of price
 * @returns Direction label
 */
export function labelDirection(params: {
  horizon: Horizon;
  realizedReturn: number;
  atrPct?: number;
}): DirLabel {
  const { horizon, realizedReturn, atrPct } = params;
  
  // Use ATR-based thresholds if atrPct provided, else fall back to fixed
  const { win, neutral } = atrPct !== undefined && atrPct > 0
    ? getDirThresholdsFromAtr(horizon, atrPct)
    : DIR_THRESHOLDS[horizon];
  
  const r = realizedReturn;

  // Clear directional signal
  if (r >= win) {
    return 'UP';
  }
  
  if (r <= -win) {
    return 'DOWN';
  }

  // Neutral zone: too small to be meaningful
  if (Math.abs(r) <= neutral) {
    return 'NEUTRAL';
  }

  // Zone between neutral and win -> soft neutral
  // This prevents labeling noise as signal
  return 'NEUTRAL';
}

// ═══════════════════════════════════════════════════════════════
// BATCH LABELING
// ═══════════════════════════════════════════════════════════════

export function labelDirectionBatch(samples: Array<{
  horizon: Horizon;
  realizedReturn: number;
}>): DirLabel[] {
  return samples.map(s => labelDirection(s));
}

// ═══════════════════════════════════════════════════════════════
// LABEL DISTRIBUTION ANALYSIS
// ═══════════════════════════════════════════════════════════════

export interface LabelDistribution {
  UP: number;
  DOWN: number;
  NEUTRAL: number;
  total: number;
  upPct: number;
  downPct: number;
  neutralPct: number;
  coverage: number; // (UP + DOWN) / total - actionable signals
}

export function analyzeLabelDistribution(labels: DirLabel[]): LabelDistribution {
  const counts = { UP: 0, DOWN: 0, NEUTRAL: 0 };
  
  for (const label of labels) {
    counts[label]++;
  }
  
  const total = labels.length || 1;
  const actionable = counts.UP + counts.DOWN;
  
  return {
    ...counts,
    total: labels.length,
    upPct: (counts.UP / total) * 100,
    downPct: (counts.DOWN / total) * 100,
    neutralPct: (counts.NEUTRAL / total) * 100,
    coverage: (actionable / total) * 100,
  };
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLD VALIDATION
// ═══════════════════════════════════════════════════════════════

/**
 * Check if thresholds produce reasonable label distribution.
 * Ideal: ~30-40% UP, ~30-40% DOWN, ~20-40% NEUTRAL
 * Bad: >70% any single class
 */
export function validateThresholds(
  returns: number[],
  horizon: Horizon
): { valid: boolean; distribution: LabelDistribution; warning?: string } {
  const labels = returns.map(r => labelDirection({ horizon, realizedReturn: r }));
  const dist = analyzeLabelDistribution(labels);
  
  let warning: string | undefined;
  let valid = true;
  
  if (dist.neutralPct > 70) {
    warning = 'Too many NEUTRAL - thresholds may be too tight';
    valid = false;
  }
  
  if (dist.upPct > 60 || dist.downPct > 60) {
    warning = 'Class imbalance - market may be trending or thresholds too loose';
    valid = false;
  }
  
  if (dist.coverage < 20) {
    warning = 'Low coverage - model will rarely trade';
  }
  
  return { valid, distribution: dist, warning };
}

console.log('[Exchange ML] Direction labeler loaded');
