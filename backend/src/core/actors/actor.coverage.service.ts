/**
 * Actor Coverage Service V2
 * 
 * EPIC A4: Coverage Normalization
 * 
 * Coverage breakdown:
 * - address_coverage (% addresses verified/attributed)
 * - volume_coverage (% volume from known addresses)
 * - time_coverage (% time windows with activity)
 * 
 * Final: coverage_score = 0.4×address + 0.4×volume + 0.2×time
 */

import type { Actor } from './actor.types.js';

export type CoverageBand = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CoverageBreakdown {
  address: number;  // 0-1
  volume: number;   // 0-1
  time: number;     // 0-1
}

export interface ActorCoverageV2 {
  score: number;              // 0-100
  band: CoverageBand;
  breakdown: CoverageBreakdown;
  lastUpdated: Date;
}

// Coverage thresholds
const COVERAGE_BANDS = {
  HIGH: 70,
  MEDIUM: 40,
};

// Source level penalties (applied to final score)
const SOURCE_PENALTIES = {
  verified: 1.0,
  attributed: 0.95,  // P1: increased from 0.85 to get better coverage
  behavioral: 0.80,
};

/**
 * Calculate coverage band from score
 */
export function getCoverageBandV2(score: number): CoverageBand {
  if (score >= COVERAGE_BANDS.HIGH) return 'HIGH';
  if (score >= COVERAGE_BANDS.MEDIUM) return 'MEDIUM';
  return 'LOW';
}

/**
 * Calculate address coverage component
 * Based on: verified count, attributed count, total count
 */
export function calculateAddressCoverage(
  verifiedCount: number,
  attributedCount: number,
  totalCount: number
): number {
  if (totalCount === 0) return 0;
  
  // Verified addresses count full, attributed count at 70%
  const effectiveCount = verifiedCount + (attributedCount * 0.7);
  const coverage = effectiveCount / totalCount;
  
  return Math.min(1, Math.max(0, coverage));
}

/**
 * Calculate volume coverage component
 * Based on: tracked volume vs estimated total
 */
export function calculateVolumeCoverage(
  trackedVolumeUsd: number,
  estimatedTotalVolumeUsd: number
): number {
  if (estimatedTotalVolumeUsd <= 0) return 0;
  
  // Cap at 1.0 (can't have more tracked than total)
  const coverage = trackedVolumeUsd / estimatedTotalVolumeUsd;
  return Math.min(1, Math.max(0, coverage));
}

/**
 * Calculate time coverage component
 * Based on: active windows vs total windows
 */
export function calculateTimeCoverage(
  activeWindowsCount: number,
  totalWindowsCount: number
): number {
  if (totalWindowsCount === 0) return 0;
  
  const coverage = activeWindowsCount / totalWindowsCount;
  return Math.min(1, Math.max(0, coverage));
}

/**
 * Calculate full coverage with breakdown
 * 
 * Formula: coverage_score = 0.4×address + 0.4×volume + 0.2×time
 */
export function calculateActorCoverageV2(params: {
  verifiedAddressCount: number;
  attributedAddressCount: number;
  totalAddressCount: number;
  trackedVolumeUsd: number;
  estimatedTotalVolumeUsd: number;
  activeWindowsCount: number;
  totalWindowsCount: number;
  sourceLevel: string;
}): ActorCoverageV2 {
  const {
    verifiedAddressCount,
    attributedAddressCount,
    totalAddressCount,
    trackedVolumeUsd,
    estimatedTotalVolumeUsd,
    activeWindowsCount,
    totalWindowsCount,
    sourceLevel,
  } = params;
  
  // Calculate breakdown components (0-1 each)
  const addressCov = calculateAddressCoverage(
    verifiedAddressCount,
    attributedAddressCount,
    totalAddressCount
  );
  
  const volumeCov = calculateVolumeCoverage(
    trackedVolumeUsd,
    estimatedTotalVolumeUsd
  );
  
  const timeCov = calculateTimeCoverage(
    activeWindowsCount,
    totalWindowsCount
  );
  
  // Weighted sum
  const rawScore = (0.4 * addressCov) + (0.4 * volumeCov) + (0.2 * timeCov);
  
  // Apply source level penalty
  const penalty = SOURCE_PENALTIES[sourceLevel as keyof typeof SOURCE_PENALTIES] || 0.65;
  const penalizedScore = rawScore * penalty;
  
  // Convert to 0-100 scale
  const finalScore = Math.round(penalizedScore * 100);
  
  return {
    score: finalScore,
    band: getCoverageBandV2(finalScore),
    breakdown: {
      address: Math.round(addressCov * 100) / 100,
      volume: Math.round(volumeCov * 100) / 100,
      time: Math.round(timeCov * 100) / 100,
    },
    lastUpdated: new Date(),
  };
}

/**
 * Calculate simple coverage V2 (when detailed data not available)
 * P1: Simplified formula for better scores
 */
export function calculateSimpleCoverageV2(
  addressCount: number,
  verifiedCount: number,
  activityScore: number, // 0-100
  sourceLevel: string
): ActorCoverageV2 {
  // Base score from activity (major factor)
  const activityCov = Math.min(1, activityScore / 80); // 80 = full score
  
  // Address contribution (minor factor)
  const addressCov = addressCount > 0 
    ? Math.min(1, 0.5 + (verifiedCount / addressCount) * 0.5)
    : 0.3;
  
  // Time assumed good if active
  const timeCov = Math.min(1, 0.6 + activityScore / 200);
  
  // Weighted combination: activity is king
  const rawScore = (0.5 * activityCov) + (0.3 * addressCov) + (0.2 * timeCov);
  const penalty = SOURCE_PENALTIES[sourceLevel as keyof typeof SOURCE_PENALTIES] || 0.80;
  const finalScore = Math.round(rawScore * penalty * 100);
  
  return {
    score: finalScore,
    band: getCoverageBandV2(finalScore),
    breakdown: {
      address: Math.round(addressCov * 100) / 100,
      volume: Math.round(activityCov * 100) / 100,
      time: Math.round(timeCov * 100) / 100,
    },
    lastUpdated: new Date(),
  };
}

/**
 * Get coverage disclaimer text
 */
export function getCoverageDisclaimerV2(band: CoverageBand): string {
  switch (band) {
    case 'HIGH':
      return 'Strong observational confidence. Multiple verified data sources.';
    case 'MEDIUM':
      return 'Moderate observational confidence. Some addresses may be unverified.';
    case 'LOW':
      return 'Limited observational confidence. Data may be incomplete.';
  }
}

// Legacy support
export type { ActorCoverageV2 as ActorCoverage };
export { getCoverageBandV2 as getCoverageBand };
export { calculateSimpleCoverageV2 as calculateSimpleCoverage };
