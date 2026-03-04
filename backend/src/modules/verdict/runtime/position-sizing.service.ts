/**
 * POSITION SIZING SERVICE (Block 3)
 * ==================================
 * 
 * Dynamic position sizing using Kelly-lite formula.
 * Calculates optimal position size based on:
 * - Final confidence (post all adjustments)
 * - Risk level
 * - Horizon
 * - Health state
 * 
 * Kelly Formula (simplified):
 *   f* = (p * b - q) / b
 *   where:
 *     p = probability of win (confidence)
 *     q = probability of loss (1 - p)
 *     b = win/loss ratio (assumed 1.5 for crypto)
 * 
 * Kelly-lite: We use fractional Kelly (0.25-0.5x) for safety
 */

import type { RiskLevel, Horizon, HealthState } from "../contracts/verdict.types.js";

export interface PositionSizingInput {
  confidence: number;       // 0..1, final adjusted confidence
  expectedReturn: number;   // signed, e.g. 0.05 = +5%
  risk: RiskLevel;          // LOW/MEDIUM/HIGH
  horizon: Horizon;         // 1D/7D/30D
  healthState?: HealthState; // HEALTHY/DEGRADED/CRITICAL
  maxPositionPct?: number;  // max allowed position (default 25%)
}

export interface PositionSizingResult {
  positionSizePct: number;  // final position size %
  kellyRaw: number;         // raw Kelly fraction
  kellyFractional: number;  // fractional Kelly (half Kelly)
  factors: {
    confidence: number;
    risk: number;
    horizon: number;
    health: number;
  };
  notes: string;
}

// Risk level multipliers
const RISK_MULTIPLIERS: Record<RiskLevel, number> = {
  LOW: 1.0,      // Full size
  MEDIUM: 0.65,  // 65% size
  HIGH: 0.35,    // 35% size
};

// Horizon multipliers (longer horizon = smaller position due to uncertainty)
const HORIZON_MULTIPLIERS: Record<Horizon, number> = {
  "1D": 1.0,     // Full size
  "7D": 0.8,     // 80% size
  "30D": 0.6,    // 60% size
};

// Health state multipliers
const HEALTH_MULTIPLIERS: Record<HealthState, number> = {
  HEALTHY: 1.0,    // Full size
  DEGRADED: 0.5,   // 50% size
  CRITICAL: 0.2,   // 20% size
};

// Kelly parameters
const WIN_LOSS_RATIO = 1.5;       // Assumed average win/loss ratio for crypto
const KELLY_FRACTION = 0.25;     // Use 1/4 Kelly for safety (conservative)
const MIN_CONFIDENCE = 0.52;     // Below this, position = 0
const MAX_KELLY_CAP = 0.25;      // Max 25% even if Kelly says more

/**
 * Calculate raw Kelly criterion
 * f* = (p * b - q) / b
 * 
 * @param confidence Win probability (p)
 * @param winLossRatio Expected win/loss ratio (b)
 * @returns Raw Kelly fraction (can be negative if confidence too low)
 */
function calculateRawKelly(confidence: number, winLossRatio: number): number {
  const p = confidence;
  const q = 1 - p;
  const b = winLossRatio;
  
  return (p * b - q) / b;
}

/**
 * Edge-adjusted Kelly
 * If expected return is small, reduce Kelly further
 */
function calculateEdgeAdjustedKelly(
  rawKelly: number,
  expectedReturn: number
): number {
  // If expected return is less than 1%, scale down Kelly
  const absReturn = Math.abs(expectedReturn);
  if (absReturn < 0.01) {
    return rawKelly * (absReturn / 0.01);
  }
  // If expected return is > 5%, slight boost (capped)
  if (absReturn > 0.05) {
    return rawKelly * Math.min(1.2, absReturn / 0.05);
  }
  return rawKelly;
}

/**
 * Calculate dynamic position size using Kelly-lite
 */
export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult {
  const {
    confidence,
    expectedReturn,
    risk,
    horizon,
    healthState = "HEALTHY",
    maxPositionPct = 0.25,
  } = input;

  // If confidence below threshold, no position
  if (confidence < MIN_CONFIDENCE) {
    return {
      positionSizePct: 0,
      kellyRaw: 0,
      kellyFractional: 0,
      factors: {
        confidence: 0,
        risk: RISK_MULTIPLIERS[risk],
        horizon: HORIZON_MULTIPLIERS[horizon],
        health: HEALTH_MULTIPLIERS[healthState],
      },
      notes: `Confidence ${(confidence * 100).toFixed(1)}% below threshold ${MIN_CONFIDENCE * 100}%`,
    };
  }

  // Step 1: Calculate raw Kelly
  const kellyRaw = calculateRawKelly(confidence, WIN_LOSS_RATIO);
  
  // Step 2: Edge adjustment
  const kellyEdge = calculateEdgeAdjustedKelly(kellyRaw, expectedReturn);
  
  // Step 3: Apply fractional Kelly (1/4 Kelly)
  const kellyFractional = Math.max(0, kellyEdge * KELLY_FRACTION);
  
  // Step 4: Apply multipliers
  const riskMul = RISK_MULTIPLIERS[risk];
  const horizonMul = HORIZON_MULTIPLIERS[horizon];
  const healthMul = HEALTH_MULTIPLIERS[healthState];
  
  // Step 5: Calculate final position
  let position = kellyFractional * riskMul * horizonMul * healthMul;
  
  // Step 6: Apply caps
  position = Math.min(position, MAX_KELLY_CAP);
  position = Math.min(position, maxPositionPct);
  position = Math.max(0, position);

  // Build notes
  const notes = [
    `Kelly=${(kellyRaw * 100).toFixed(1)}%`,
    `frac=${(kellyFractional * 100).toFixed(2)}%`,
    `risk=${riskMul}`,
    `horizon=${horizonMul}`,
    `health=${healthMul}`,
  ].join(", ");

  return {
    positionSizePct: position,
    kellyRaw,
    kellyFractional,
    factors: {
      confidence,
      risk: riskMul,
      horizon: horizonMul,
      health: healthMul,
    },
    notes,
  };
}

/**
 * Position Sizing Service class
 */
export class PositionSizingService {
  calculate(input: PositionSizingInput): PositionSizingResult {
    return calculatePositionSize(input);
  }
  
  /**
   * Simplified method for compatibility with existing code
   */
  getPositionSize(
    confidence: number,
    risk: RiskLevel,
    maxPct: number,
    horizon: Horizon = "7D",
    healthState: HealthState = "HEALTHY",
    expectedReturn: number = 0.05
  ): number {
    const result = calculatePositionSize({
      confidence,
      expectedReturn,
      risk,
      horizon,
      healthState,
      maxPositionPct: maxPct,
    });
    return result.positionSizePct;
  }
}

// Export singleton
export const positionSizingService = new PositionSizingService();

console.log('[Verdict] Position Sizing Service loaded (Block 3: Kelly-lite)');
