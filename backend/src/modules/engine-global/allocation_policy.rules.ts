/**
 * ALLOCATION POLICY RULES — P5.2
 * 
 * Hard rules for position sizing. Engine doesn't change direction,
 * only applies caps and adjustments based on risk hierarchy.
 */

import type { GuardLevel, LiquidityRegime, Confidence } from './engine_global.contract.js';

// ═══════════════════════════════════════════════════════════════
// 1️⃣ GUARD OVERRIDES (Priority #1 — Always Applied First)
// ═══════════════════════════════════════════════════════════════

export const GUARD_CAPS: Record<GuardLevel, { spx: number; btc: number; dxy: number }> = {
  'BLOCK': { spx: 0, btc: 0, dxy: 0.50 },
  'CRISIS': { spx: 0.35, btc: 0.25, dxy: 0.60 },
  'WARN': { spx: 0.75, btc: 0.65, dxy: 0.80 },
  'NONE': { spx: 1.0, btc: 1.0, dxy: 1.0 },
};

// ═══════════════════════════════════════════════════════════════
// 2️⃣ LIQUIDITY ADJUSTMENTS (Applied After Guard)
// ═══════════════════════════════════════════════════════════════

export const LIQUIDITY_MULTIPLIERS: Record<LiquidityRegime, { spx: number; btc: number; dxy: number }> = {
  'EXPANSION': { spx: 1.05, btc: 1.15, dxy: 0.95 },
  'NEUTRAL': { spx: 1.0, btc: 1.0, dxy: 1.0 },
  'CONTRACTION': { spx: 0.85, btc: 0.75, dxy: 1.10 },
};

// ═══════════════════════════════════════════════════════════════
// 3️⃣ CONFIDENCE SCALING
// ═══════════════════════════════════════════════════════════════

export const CONFIDENCE_MULTIPLIERS: Record<Confidence, number> = {
  'LOW': 0.80,
  'MEDIUM': 1.0,
  'HIGH': 1.05,
};

export const CONFIDENCE_THRESHOLDS = {
  LOW_CUTOFF: 0.40,
  HIGH_CUTOFF: 0.75,
};

// ═══════════════════════════════════════════════════════════════
// 4️⃣ RISK HIERARCHY (BTC > SPX > DXY)
// ═══════════════════════════════════════════════════════════════

// When signals conflict, apply risk hierarchy haircuts
export const CONFLICT_HAIRCUTS = {
  // Fractal LONG + Macro RISK_OFF + Liquidity CONTRACTION
  SEVERE_CONFLICT: { spx: 0.70, btc: 0.50, dxy: 1.0 },
  
  // Macro RISK_OFF only
  MACRO_BEARISH: { spx: 0.85, btc: 0.75, dxy: 1.0 },
  
  // Liquidity CONTRACTION only
  LIQUIDITY_DRAIN: { spx: 0.90, btc: 0.70, dxy: 1.05 },
};

// ═══════════════════════════════════════════════════════════════
// 5️⃣ ABSOLUTE CONSTRAINTS
// ═══════════════════════════════════════════════════════════════

export const ABSOLUTE_CONSTRAINTS = {
  MIN_SIZE: 0,
  MAX_SIZE: 1,
  MIN_CASH: 0.10, // Always keep 10% cash minimum
};

// ═══════════════════════════════════════════════════════════════
// POLICY APPLICATION ORDER
// ═══════════════════════════════════════════════════════════════

/**
 * Policy application order (strict):
 * 1. Start with cascade sizes
 * 2. Apply guard caps (hard ceiling)
 * 3. Apply liquidity adjustments
 * 4. Apply confidence scaling
 * 5. Apply conflict resolution
 * 6. Final clamp to [0, 1]
 * 7. Ensure minimum cash
 */

export const POLICY_VERSION = '5.2.0';
