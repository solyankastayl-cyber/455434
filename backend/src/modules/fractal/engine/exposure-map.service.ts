/**
 * BLOCK 39.2 — Smooth Exposure Mapping Service
 * 
 * Converts consensus score to smooth position size [0..1].
 * Eliminates step-function behavior for better risk management.
 */

import {
  ExposureMapConfig,
  ExposureResult,
  DEFAULT_EXPOSURE_MAP_CONFIG,
} from '../contracts/institutional.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

// ═══════════════════════════════════════════════════════════════
// Smooth Exposure Mapping
// ═══════════════════════════════════════════════════════════════

/**
 * Map absolute score to [0..1] exposure smoothly
 * Uses piecewise power ramp with optional bleed
 * 
 * @param absScore - absolute value of assembled score
 * @param cfg - exposure mapping configuration
 */
export function smoothExposure(
  absScore: number,
  cfg: ExposureMapConfig = DEFAULT_EXPOSURE_MAP_CONFIG
): number {
  const s = Math.max(0, absScore);
  
  // Optional bleed for very small scores
  if (s < cfg.enter) {
    return clamp01(cfg.bleed * (s / Math.max(cfg.enter, 1e-9)));
  }
  
  // Normalized ramp from enter to full
  const denom = Math.max(cfg.full - cfg.enter, 1e-9);
  const x = clamp01((s - cfg.enter) / denom);
  
  // Apply curvature (gamma)
  const y = Math.pow(x, Math.max(cfg.gamma, 1e-6));
  
  // Ensure minimum exposure once activated
  const out = cfg.minOn + (1 - cfg.minOn) * y;
  return clamp01(out);
}

/**
 * Alternative: tanh-based smooth mapping
 * More gradual transition
 */
export function tanhExposure(
  absScore: number,
  k: number = 10,        // steepness
  offset: number = 0.1   // score offset for activation
): number {
  const adjusted = Math.max(0, absScore - offset);
  return clamp01(Math.tanh(k * adjusted));
}

/**
 * Alternative: sigmoid-based mapping
 */
export function sigmoidExposure(
  absScore: number,
  k: number = 15,
  midpoint: number = 0.15
): number {
  return 1 / (1 + Math.exp(-k * (absScore - midpoint)));
}

// ═══════════════════════════════════════════════════════════════
// Combined Exposure with All Modifiers
// ═══════════════════════════════════════════════════════════════

export interface ExposureInput {
  absScore: number;
  entropyScale: number;        // 0..1 from Entropy Guard
  reliabilityModifier: number; // 0..1 from Reliability
  phaseMultiplier: number;     // 0..1+ from Phase Risk
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
}

/**
 * Compute final exposure with all modifiers applied
 */
export function computeFinalExposure(
  input: ExposureInput,
  cfg: ExposureMapConfig = DEFAULT_EXPOSURE_MAP_CONFIG
): ExposureResult {
  // Base exposure from score
  const baseExposure = smoothExposure(input.absScore, cfg);
  
  // Apply entropy scale
  const afterEntropy = baseExposure * clamp01(input.entropyScale);
  
  // Apply reliability modifier
  const afterReliability = afterEntropy * clamp01(input.reliabilityModifier);
  
  // Apply phase multiplier (can be >1 for MARKUP)
  const finalExposure = clamp01(afterReliability * input.phaseMultiplier);
  
  // If NEUTRAL, force 0
  const sizeMultiplier = input.direction === 'NEUTRAL' ? 0 : finalExposure;
  
  return {
    absScore: Math.round(input.absScore * 10000) / 10000,
    baseExposure: Math.round(baseExposure * 1000) / 1000,
    entropyScale: Math.round(input.entropyScale * 1000) / 1000,
    reliabilityModifier: Math.round(input.reliabilityModifier * 1000) / 1000,
    phaseMultiplier: Math.round(input.phaseMultiplier * 1000) / 1000,
    finalExposure: Math.round(finalExposure * 1000) / 1000,
    sizeMultiplier: Math.round(sizeMultiplier * 1000) / 1000,
  };
}

// ═══════════════════════════════════════════════════════════════
// Anti-Flip Friction
// ═══════════════════════════════════════════════════════════════

/**
 * Apply friction to prevent rapid direction changes
 * Only flip if new score exceeds threshold beyond current direction
 */
export function applyAntiFlipFriction(
  currentDirection: 'LONG' | 'SHORT' | 'NEUTRAL',
  newScore: number,
  flipThreshold: number = 0.05
): {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  flipped: boolean;
  friction: number;
} {
  const newDirection: 'LONG' | 'SHORT' | 'NEUTRAL' = 
    newScore > 0.02 ? 'LONG' :
    newScore < -0.02 ? 'SHORT' : 'NEUTRAL';
  
  // No friction if staying same or going to NEUTRAL
  if (newDirection === currentDirection || newDirection === 'NEUTRAL') {
    return { direction: newDirection, flipped: false, friction: 0 };
  }
  
  // Flip from NEUTRAL requires lower threshold
  if (currentDirection === 'NEUTRAL') {
    return { direction: newDirection, flipped: true, friction: 0 };
  }
  
  // Flip from opposite requires exceeding friction threshold
  const isFlip = 
    (currentDirection === 'LONG' && newScore < -flipThreshold) ||
    (currentDirection === 'SHORT' && newScore > flipThreshold);
  
  if (isFlip) {
    return { direction: newDirection, flipped: true, friction: flipThreshold };
  }
  
  // Not enough conviction to flip - stay current
  return { direction: currentDirection, flipped: false, friction: flipThreshold };
}
