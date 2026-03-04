/**
 * S10.4 — Liquidation Cascade Detector
 * 
 * Detects and classifies liquidation cascades.
 * A cascade is NOT just liquidations - it's a chain reaction.
 * 
 * NO signals, NO predictions — only structural diagnosis.
 */

import {
  CascadeDirection,
  CascadePhase,
  CascadeIntensity,
  CascadeDetectionInput,
  CascadeThresholds,
  DEFAULT_CASCADE_THRESHOLDS,
  CASCADE_ELIGIBLE_REGIMES,
} from './cascade.types.js';

/**
 * Check if current regime is eligible for cascade detection
 */
export function isRegimeEligible(regime: string): boolean {
  return CASCADE_ELIGIBLE_REGIMES.includes(regime as any);
}

/**
 * Determine cascade direction from liquidation volumes
 */
export function detectDirection(
  longVolume: number,
  shortVolume: number
): CascadeDirection | null {
  if (longVolume <= 0 && shortVolume <= 0) return null;
  
  const total = longVolume + shortVolume;
  const longRatio = longVolume / total;
  
  // Need clear dominance (>70%) to declare direction
  if (longRatio > 0.7) return 'LONG';   // Longs being wiped
  if (longRatio < 0.3) return 'SHORT';  // Shorts being wiped
  
  return null; // Mixed liquidations, no clear cascade
}

/**
 * Calculate intensity score (0-1)
 */
export function calculateIntensityScore(
  input: CascadeDetectionInput,
  thresholds: CascadeThresholds = DEFAULT_CASCADE_THRESHOLDS
): number {
  const { liquidationVolumeUsd, oiDeltaPct, priceVelocity } = input;
  const { volumeWeight, oiWeight, priceWeight } = thresholds;
  
  // Normalize each component (0-1)
  const volumeNorm = Math.min(liquidationVolumeUsd / 10000000, 1);   // $10M = max
  const oiNorm = Math.min(Math.abs(oiDeltaPct) / 10, 1);             // 10% = max
  const priceNorm = Math.min(Math.abs(priceVelocity) / 5, 1);        // 5%/min = max
  
  const score = 
    volumeNorm * volumeWeight +
    oiNorm * oiWeight +
    priceNorm * priceWeight;
  
  return Math.min(score, 1);
}

/**
 * Convert intensity score to level
 */
export function scoreToIntensity(score: number): CascadeIntensity {
  if (score >= 0.85) return 'EXTREME';
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.3) return 'MEDIUM';
  return 'LOW';
}

/**
 * Determine cascade phase based on current vs previous state
 */
export function determinePhase(
  currentRate: number,
  previousRate: number,
  peakRate: number,
  baselineRate: number,
  thresholds: CascadeThresholds = DEFAULT_CASCADE_THRESHOLDS
): CascadePhase {
  const { decayThreshold, baselineRateMultiplier } = thresholds;
  
  // END: Rate returned to baseline
  if (currentRate <= baselineRate * 1.2) {
    return 'END';
  }
  
  // DECAY: Rate dropped >30% from peak
  if (peakRate > 0 && currentRate < peakRate * (1 - decayThreshold / 100)) {
    return 'DECAY';
  }
  
  // PEAK: Current is the highest we've seen
  if (currentRate >= peakRate * 0.95) {
    return 'PEAK';
  }
  
  // ACTIVE: Sustained high rate
  if (currentRate >= baselineRate * baselineRateMultiplier) {
    return 'ACTIVE';
  }
  
  // START: Initial spike
  return 'START';
}

/**
 * Main cascade detection function
 */
export function detectCascade(
  input: CascadeDetectionInput,
  previousState: {
    wasActive: boolean;
    previousRate: number;
    peakRate: number;
    baselineRate: number;
  },
  thresholds: CascadeThresholds = DEFAULT_CASCADE_THRESHOLDS
): {
  active: boolean;
  direction: CascadeDirection | null;
  phase: CascadePhase | null;
  intensity: CascadeIntensity;
  intensityScore: number;
  confidence: number;
  drivers: string[];
  eligible: boolean;
  eligibilityReason: string;
} {
  const drivers: string[] = [];
  
  // Check regime eligibility
  if (!isRegimeEligible(input.regime)) {
    return {
      active: false,
      direction: null,
      phase: null,
      intensity: 'LOW',
      intensityScore: 0,
      confidence: 0,
      drivers: [],
      eligible: false,
      eligibilityReason: `Regime ${input.regime} not eligible for cascade`,
    };
  }
  
  // Check minimum thresholds
  const meetsMinRate = input.liquidationRate >= thresholds.minLiquidationRate;
  const meetsMinVolume = input.liquidationVolumeUsd >= thresholds.minVolumeUsd;
  const meetsMinOi = Math.abs(input.oiDeltaPct) >= thresholds.minOiDrop;
  const meetsMinPrice = Math.abs(input.priceDeltaPct) >= thresholds.minPriceMove;
  
  if (!meetsMinRate || !meetsMinVolume) {
    return {
      active: false,
      direction: null,
      phase: null,
      intensity: 'LOW',
      intensityScore: 0,
      confidence: 0,
      drivers: [],
      eligible: true,
      eligibilityReason: meetsMinRate 
        ? 'Volume below cascade threshold'
        : 'Liquidation rate below threshold',
    };
  }
  
  // Calculate intensity
  const intensityScore = calculateIntensityScore(input, thresholds);
  const intensity = scoreToIntensity(intensityScore);
  
  // Detect direction
  const direction = detectDirection(input.longLiqVolume, input.shortLiqVolume);
  
  if (!direction) {
    return {
      active: false,
      direction: null,
      phase: null,
      intensity,
      intensityScore,
      confidence: 0.3,
      drivers: ['Mixed liquidations, no clear direction'],
      eligible: true,
      eligibilityReason: 'No dominant direction',
    };
  }
  
  // Determine phase
  const phase = determinePhase(
    input.liquidationRate,
    previousState.previousRate,
    previousState.peakRate,
    previousState.baselineRate,
    thresholds
  );
  
  // Build drivers
  if (direction === 'LONG') {
    drivers.push('Long positions being liquidated');
  } else {
    drivers.push('Short positions being liquidated');
  }
  
  if (meetsMinOi) {
    drivers.push(`OI collapsed ${Math.abs(input.oiDeltaPct).toFixed(1)}%`);
  }
  
  if (meetsMinPrice) {
    const priceDir = input.priceDeltaPct > 0 ? 'up' : 'down';
    drivers.push(`Price moved ${priceDir} ${Math.abs(input.priceDeltaPct).toFixed(1)}%`);
  }
  
  if (intensity === 'EXTREME' || intensity === 'HIGH') {
    drivers.push('Forced market orders flooding');
  }
  
  // Calculate confidence
  let confidence = 0.5;
  if (meetsMinOi) confidence += 0.15;
  if (meetsMinPrice) confidence += 0.15;
  if (intensity === 'HIGH' || intensity === 'EXTREME') confidence += 0.2;
  confidence = Math.min(confidence, 1);
  
  const isActive = phase !== 'END' && intensity !== 'LOW';
  
  return {
    active: isActive,
    direction,
    phase: isActive ? phase : null,
    intensity,
    intensityScore,
    confidence,
    drivers,
    eligible: true,
    eligibilityReason: 'All conditions met',
  };
}
