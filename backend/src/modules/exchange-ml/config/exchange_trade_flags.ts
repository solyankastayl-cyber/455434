/**
 * Exchange Trade Flags Configuration
 * ===================================
 * 
 * Control flags for risk management without touching the ML model.
 * 
 * Key levers:
 * - Horizon enable/disable (1D/7D off, 30D on)
 * - CHOP regime gating
 * - DD Guard (equity drawdown protection)
 */

export type Horizon = '1D' | '7D' | '30D';
export type Regime = 'BULL' | 'BEAR' | 'CHOP' | 'UNKNOWN';

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// ═══════════════════════════════════════════════════════════════
// TRADE FLAGS
// ═══════════════════════════════════════════════════════════════

export const EXCHANGE_TRADE_FLAGS = {
  // Horizon trading enable/disable
  // 1D/7D are toxic (negative Sharpe) → disable by default
  // 30D is profitable → enable by default
  enabledByHorizon: {
    '1D': process.env.EXCH_TRADE_ENABLE_1D === 'true',      // default: false
    '7D': process.env.EXCH_TRADE_ENABLE_7D === 'true',      // default: false
    '30D': process.env.EXCH_TRADE_ENABLE_30D !== 'false',   // default: true
  } as Record<Horizon, boolean>,

  // CHOP regime handling
  // If chopHardDisable=true → completely block trades in CHOP
  // Otherwise → reduce size by chopSizeMultiplier
  chopHardDisable: process.env.EXCH_TRADE_CHOP_DISABLE === 'true',
  chopSizeMultiplier: clamp01(parseFloat(process.env.EXCH_TRADE_CHOP_SIZE_MULT ?? '0.25')),

  // DD Guard: if equity drawdown exceeds threshold → risk-off for N days
  ddGuardEnabled: process.env.EXCH_DD_GUARD_ENABLED === 'true',
  ddGuardMaxDD: clamp01(parseFloat(process.env.EXCH_DD_GUARD_MAX_DD ?? '0.25')),
  ddGuardCooldownDays: clampInt(parseInt(process.env.EXCH_DD_GUARD_COOLDOWN_DAYS ?? '21', 10), 1, 180),

  // Size multipliers by horizon (risk tilt)
  horizonSizeMultiplier: {
    '1D': clamp01(parseFloat(process.env.EXCH_SIZE_MULT_1D ?? '0.6')),
    '7D': clamp01(parseFloat(process.env.EXCH_SIZE_MULT_7D ?? '0.8')),
    '30D': clamp01(parseFloat(process.env.EXCH_SIZE_MULT_30D ?? '1.0')),
  } as Record<Horizon, number>,
};

// ═══════════════════════════════════════════════════════════════
// SMART SIZE CALCULATOR
// ═══════════════════════════════════════════════════════════════

export interface SizeCalculatorInput {
  horizon: Horizon;
  regime: Regime;
  confidence: number;
  edgeProb: number;
  baseSize?: number;
}

/**
 * Calculate position size multiplier based on risk factors.
 * This is the core risk management function.
 * 
 * Factors:
 * - Regime (CHOP = smaller)
 * - Confidence (low = smaller)
 * - Edge probability (low = smaller)
 * - Horizon risk tilt (1D = smaller, 30D = full)
 */
export function calculateSmartSizeMultiplier(input: SizeCalculatorInput): {
  multiplier: number;
  reasons: string[];
} {
  const { horizon, regime, confidence, edgeProb, baseSize = 1 } = input;
  const reasons: string[] = [];
  let multiplier = baseSize;

  // 1. Horizon enable check
  if (!EXCHANGE_TRADE_FLAGS.enabledByHorizon[horizon]) {
    return { multiplier: 0, reasons: [`HORIZON_DISABLED:${horizon}`] };
  }

  // 2. CHOP regime handling
  if (regime === 'CHOP') {
    if (EXCHANGE_TRADE_FLAGS.chopHardDisable) {
      return { multiplier: 0, reasons: ['REGIME_DISABLED:CHOP'] };
    }
    multiplier *= EXCHANGE_TRADE_FLAGS.chopSizeMultiplier;
    reasons.push(`CHOP_SIZE:x${EXCHANGE_TRADE_FLAGS.chopSizeMultiplier.toFixed(2)}`);
  }

  // 3. Confidence scaling
  if (confidence < 0.45) {
    multiplier *= 0.40;
    reasons.push('CONF_VERY_LOW:x0.40');
  } else if (confidence < 0.50) {
    multiplier *= 0.60;
    reasons.push('CONF_LOW:x0.60');
  } else if (confidence < 0.55) {
    multiplier *= 0.75;
    reasons.push('CONF_MEDIUM:x0.75');
  }

  // 4. Edge probability scaling
  if (edgeProb < 0.52) {
    multiplier *= 0.50;
    reasons.push('EDGE_VERY_LOW:x0.50');
  } else if (edgeProb < 0.55) {
    multiplier *= 0.70;
    reasons.push('EDGE_LOW:x0.70');
  }

  // 5. Horizon risk tilt
  const horizonMult = EXCHANGE_TRADE_FLAGS.horizonSizeMultiplier[horizon];
  multiplier *= horizonMult;
  if (horizonMult < 1) {
    reasons.push(`HORIZON_TILT:x${horizonMult.toFixed(2)}`);
  }

  // Clamp final multiplier
  multiplier = clamp01(multiplier);

  if (reasons.length === 0) {
    reasons.push('FULL_SIZE');
  }

  return { multiplier, reasons };
}

// ═══════════════════════════════════════════════════════════════
// DD GUARD STATE
// ═══════════════════════════════════════════════════════════════

export interface DDGuardState {
  equityPeak: number;
  currentEquity: number;
  maxDrawdown: number;
  riskOffUntilDay: number | null;
  lastTriggerDay: number | null;
}

export function createDDGuardState(): DDGuardState {
  return {
    equityPeak: 1,
    currentEquity: 1,
    maxDrawdown: 0,
    riskOffUntilDay: null,
    lastTriggerDay: null,
  };
}

export function updateDDGuard(
  state: DDGuardState,
  dayIndex: number,
  tradePnl: number
): { isRiskOff: boolean; reason?: string } {
  // Update equity
  state.currentEquity *= (1 + tradePnl);
  state.equityPeak = Math.max(state.equityPeak, state.currentEquity);

  // Calculate current drawdown
  const currentDD = state.equityPeak > 0 
    ? (state.equityPeak - state.currentEquity) / state.equityPeak 
    : 0;
  state.maxDrawdown = Math.max(state.maxDrawdown, currentDD);

  // Check if risk-off is active
  if (state.riskOffUntilDay !== null && dayIndex <= state.riskOffUntilDay) {
    return { isRiskOff: true, reason: `DD_GUARD_ACTIVE:until_day_${state.riskOffUntilDay}` };
  }

  // Check if we should trigger risk-off
  if (EXCHANGE_TRADE_FLAGS.ddGuardEnabled) {
    if (currentDD >= EXCHANGE_TRADE_FLAGS.ddGuardMaxDD) {
      state.riskOffUntilDay = dayIndex + EXCHANGE_TRADE_FLAGS.ddGuardCooldownDays;
      state.lastTriggerDay = dayIndex;
      return { 
        isRiskOff: true, 
        reason: `DD_GUARD_TRIGGERED:DD=${(currentDD * 100).toFixed(1)}%>=${(EXCHANGE_TRADE_FLAGS.ddGuardMaxDD * 100).toFixed(0)}%` 
      };
    }
  }

  return { isRiskOff: false };
}

console.log('[Exchange ML] Trade flags loaded:', {
  enabledHorizons: EXCHANGE_TRADE_FLAGS.enabledByHorizon,
  chopDisable: EXCHANGE_TRADE_FLAGS.chopHardDisable,
  ddGuard: EXCHANGE_TRADE_FLAGS.ddGuardEnabled,
});
