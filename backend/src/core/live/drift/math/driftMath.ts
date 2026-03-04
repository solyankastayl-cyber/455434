/**
 * Drift Math
 * 
 * Pure functions for drift calculation.
 * NO side effects, NO Date.now(), NO random().
 */
import type { DriftLevel, DriftMetrics, DriftPercentages } from '../drift.types.js';
import { DRIFT_THRESHOLDS, DRIFT_WEIGHTS } from '../drift.types.js';

const EPSILON = 1e-6;

// ==================== METRIC DRIFT ====================

/**
 * Calculate drift for a single metric
 * 
 * drift = |LIVE - SIM| / max(|SIM|, ε)
 * 
 * @param sim - Simulated value
 * @param live - Live value
 * @returns Drift percentage (0-1+)
 */
export function metricDrift(sim: number, live: number): number {
  const denominator = Math.max(Math.abs(sim), EPSILON);
  return Math.abs(live - sim) / denominator;
}

// ==================== COMPOSITE DRIFT ====================

/**
 * Calculate composite drift from individual metrics
 * 
 * composite = 0.4 * volume + 0.4 * netFlow + 0.2 * actor
 * 
 * @param input - Individual drift percentages
 * @returns Composite drift (0-1+)
 */
export function compositeDrift(input: {
  volume: number;
  netFlow: number;
  actor: number;
}): number {
  return (
    DRIFT_WEIGHTS.volume * input.volume +
    DRIFT_WEIGHTS.netFlow * input.netFlow +
    DRIFT_WEIGHTS.actor * input.actor
  );
}

// ==================== DRIFT LEVEL ====================

/**
 * Determine drift level from composite value
 * 
 * < 0.15 = LOW
 * 0.15-0.30 = MEDIUM
 * 0.30-0.50 = HIGH
 * >= 0.50 = CRITICAL
 * 
 * @param value - Composite drift value
 * @returns DriftLevel
 */
export function driftLevel(value: number): DriftLevel {
  if (value >= DRIFT_THRESHOLDS.HIGH_MAX) return 'CRITICAL';
  if (value >= DRIFT_THRESHOLDS.MEDIUM_MAX) return 'HIGH';
  if (value >= DRIFT_THRESHOLDS.LOW_MAX) return 'MEDIUM';
  return 'LOW';
}

// ==================== FULL CALCULATION ====================

/**
 * Calculate full drift comparison between SIM and LIVE metrics
 * 
 * @param sim - Simulated metrics
 * @param live - Live metrics
 * @returns Drift percentages and level
 */
export function calculateDrift(
  sim: DriftMetrics,
  live: DriftMetrics
): { drift: DriftPercentages; level: DriftLevel } {
  // Calculate individual drifts
  const volumePct = metricDrift(sim.volume, live.volume);
  const netFlowPct = metricDrift(sim.netFlow, live.netFlow);
  const actorPct = metricDrift(sim.actorCount, live.actorCount);
  
  // Calculate composite
  const composite = compositeDrift({
    volume: volumePct,
    netFlow: netFlowPct,
    actor: actorPct,
  });
  
  // Determine level
  const level = driftLevel(composite);
  
  // Round to 4 decimal places
  return {
    drift: {
      volumePct: Math.round(volumePct * 10000) / 10000,
      netFlowPct: Math.round(netFlowPct * 10000) / 10000,
      actorPct: Math.round(actorPct * 10000) / 10000,
      composite: Math.round(composite * 10000) / 10000,
    },
    level,
  };
}

// ==================== CONFIDENCE MODIFIER ====================

/**
 * Apply drift-based confidence modifier
 * 
 * finalConfidence = baseConfidence × driftModifier
 * 
 * Modifiers:
 * - LOW: 1.0 (no change)
 * - MEDIUM: 0.85
 * - HIGH: 0.60
 * - CRITICAL: 0.30
 * 
 * @param baseConfidence - Original confidence (0-100)
 * @param level - Drift level
 * @returns Modified confidence
 */
export function applyDriftConfidence(
  baseConfidence: number,
  level: DriftLevel
): number {
  const modifiers: Record<DriftLevel, number> = {
    LOW: 1.0,
    MEDIUM: 0.85,
    HIGH: 0.60,
    CRITICAL: 0.30,
  };
  
  return Math.round(baseConfidence * modifiers[level]);
}

// ==================== ML READY HELPERS ====================

/**
 * Check if drift level allows ML training
 * 
 * CRITICAL → NOT READY
 * HIGH → CONDITIONAL
 * LOW/MEDIUM → READY
 * 
 * @param level - Drift level
 * @returns ML readiness status
 */
export function checkMLReadiness(level: DriftLevel): {
  status: 'READY' | 'CONDITIONAL' | 'NOT_READY';
  reason: string;
} {
  switch (level) {
    case 'CRITICAL':
      return {
        status: 'NOT_READY',
        reason: 'CRITICAL drift detected - world diverges significantly from model',
      };
    case 'HIGH':
      return {
        status: 'CONDITIONAL',
        reason: 'HIGH drift detected - proceed with caution, shadow mode only',
      };
    case 'MEDIUM':
    case 'LOW':
      return {
        status: 'READY',
        reason: `${level} drift - model predictions align with reality`,
      };
  }
}
