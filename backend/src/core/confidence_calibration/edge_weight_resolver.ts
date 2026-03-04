/**
 * P2.2 Phase 1: Edge Weight Resolver
 * 
 * THE HEART OF CONFIDENCE CALIBRATION
 * 
 * This module calculates the final edge weight using the locked formula:
 * 
 * edgeWeight = baseFlowWeight × routeConfidence × marketContextModifier 
 *              × dataQualityModifier × actorReliability
 * 
 * where baseFlowWeight = log1p(volumeUsd) × log1p(txCount)
 * 
 * ⚠️ CRITICAL: log1p prevents whale domination
 * ⚠️ IMMUTABLE: This formula is LOCKED after P2.2
 */

import {
  RawEdgeSignal,
  EdgeWeightCalculation,
  CalibratedEdge,
  CalibrationError,
  CalibrationConfig,
  DEFAULT_CALIBRATION_CONFIG,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Minimum volume to consider (dust filter) */
const MIN_VOLUME_USD = 0.01;

/** Minimum tx count to consider */
const MIN_TX_COUNT = 1;

/** Safety bounds for confidence values */
const CONFIDENCE_BOUNDS = { min: 0, max: 1 } as const;

// ═══════════════════════════════════════════════════════════════════════════
// CORE FORMULA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate base flow weight from volume and tx count
 * 
 * Uses log1p to prevent whale domination:
 * - $1M transaction doesn't overpower 100x $10k transactions
 * - Maintains hierarchy while being fair
 * 
 * @param volumeUsd - Total volume in USD
 * @param txCount - Number of transactions
 * @returns Base flow weight (non-normalized)
 */
function calculateBaseFlowWeight(volumeUsd: number, txCount: number): number {
  // Filter dust
  if (volumeUsd < MIN_VOLUME_USD || txCount < MIN_TX_COUNT) {
    return 0;
  }
  
  // log1p = log(1 + x) - gracefully handles small values
  const volumeComponent = Math.log1p(volumeUsd);
  const txComponent = Math.log1p(txCount);
  
  // Multiply components - both matter
  return volumeComponent * txComponent;
}

/**
 * Calculate overall confidence from components
 * 
 * Confidence is multiplicative:
 * - All components must be high for high confidence
 * - Any weak link reduces overall confidence
 * 
 * @param routeConfidence - From route intelligence [0..1]
 * @param dataQuality - From data quality gates [0..1]
 * @param actorReliability - From actor layer [0..1]
 * @returns Overall confidence [0..1]
 */
function calculateConfidence(
  routeConfidence: number,
  dataQuality: number,
  actorReliability: number
): number {
  // Multiplicative - all must be good
  const raw = routeConfidence * dataQuality * actorReliability;
  
  // Clamp to [0, 1] for safety
  return Math.max(CONFIDENCE_BOUNDS.min, Math.min(CONFIDENCE_BOUNDS.max, raw));
}

/**
 * Calculate final raw edge weight (before normalization)
 * 
 * This is the CORE FORMULA - locked after P2.2
 * 
 * @param signal - Raw edge signal
 * @returns Weight calculation details
 */
function calculateRawEdgeWeight(signal: RawEdgeSignal): EdgeWeightCalculation {
  // Step 1: Validate inputs
  validateEdgeSignal(signal);
  
  // Step 2: Calculate base flow weight
  const baseFlowWeight = calculateBaseFlowWeight(
    signal.volumeUsd,
    signal.txCount
  );
  
  // Step 3: Calculate overall confidence
  const confidence = calculateConfidence(
    signal.routeConfidence,
    signal.dataQuality,
    signal.actorReliability
  );
  
  // Step 4: Apply THE FORMULA
  const rawWeight =
    baseFlowWeight *
    signal.routeConfidence *
    signal.marketModifier *
    signal.dataQuality *
    signal.actorReliability;
  
  // Step 5: Return calculation breakdown
  return {
    edgeId: `${signal.from}-${signal.to}`,
    baseFlowWeight,
    routeConfidence: signal.routeConfidence,
    marketModifier: signal.marketModifier,
    dataQuality: signal.dataQuality,
    actorReliability: signal.actorReliability,
    rawWeight,
    confidence,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve edge weight from raw signal
 * 
 * This is the main entry point.
 * Returns both weight and confidence.
 * 
 * @param signal - Raw edge signal
 * @returns Object with weight and confidence
 */
export function resolveEdgeWeight(signal: RawEdgeSignal): {
  weight: number;
  confidence: number;
  calculation?: EdgeWeightCalculation;
} {
  try {
    const calc = calculateRawEdgeWeight(signal);
    
    return {
      weight: calc.rawWeight,
      confidence: calc.confidence,
      calculation: calc, // For debugging/audit
    };
  } catch (error) {
    throw new CalibrationError(
      `Failed to resolve edge weight: ${error.message}`,
      'EDGE_WEIGHT_RESOLUTION_FAILED',
      { signal, error }
    );
  }
}

/**
 * Batch resolve edge weights
 * 
 * More efficient than calling resolveEdgeWeight repeatedly
 * 
 * @param signals - Array of raw edge signals
 * @param config - Calibration configuration (optional)
 * @returns Array of calibrated edges (before normalization)
 */
export function resolveEdgeWeightsBatch(
  signals: RawEdgeSignal[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibratedEdge[] {
  return signals.map((signal) => {
    const result = resolveEdgeWeight(signal);
    
    return {
      from: signal.from,
      to: signal.to,
      direction: signal.direction,
      weight: result.weight,
      confidence: result.confidence,
      rawTxCount: signal.txCount,
      rawVolumeUsd: signal.volumeUsd,
      id: `${signal.from}-${signal.to}`,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate edge signal inputs
 * 
 * Ensures all required fields are present and valid
 * 
 * @param signal - Raw edge signal
 * @throws CalibrationError if invalid
 */
function validateEdgeSignal(signal: RawEdgeSignal): void {
  const errors: string[] = [];
  
  // Check required fields
  if (!signal.from) errors.push('Missing "from" address');
  if (!signal.to) errors.push('Missing "to" address');
  if (!signal.direction) errors.push('Missing "direction"');
  
  // Check numeric fields
  if (typeof signal.txCount !== 'number' || signal.txCount < 0) {
    errors.push('Invalid txCount');
  }
  if (typeof signal.volumeUsd !== 'number' || signal.volumeUsd < 0) {
    errors.push('Invalid volumeUsd');
  }
  
  // Check confidence bounds [0..1]
  if (
    signal.routeConfidence < 0 ||
    signal.routeConfidence > 1
  ) {
    errors.push(`routeConfidence out of bounds: ${signal.routeConfidence}`);
  }
  if (signal.dataQuality < 0 || signal.dataQuality > 1) {
    errors.push(`dataQuality out of bounds: ${signal.dataQuality}`);
  }
  if (
    signal.actorReliability < 0 ||
    signal.actorReliability > 1
  ) {
    errors.push(`actorReliability out of bounds: ${signal.actorReliability}`);
  }
  
  // Market modifier typically [0..2] but can vary
  if (signal.marketModifier < 0) {
    errors.push(`marketModifier cannot be negative: ${signal.marketModifier}`);
  }
  
  if (errors.length > 0) {
    throw new CalibrationError(
      'Invalid edge signal',
      'INVALID_EDGE_SIGNAL',
      { errors, signal }
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get weight breakdown for debugging
 * 
 * Shows contribution of each component
 * 
 * @param signal - Raw edge signal
 * @returns Human-readable breakdown
 */
export function getWeightBreakdown(signal: RawEdgeSignal): string {
  const calc = calculateRawEdgeWeight(signal);
  
  return `
Edge Weight Breakdown:
  Base Flow Weight: ${calc.baseFlowWeight.toFixed(4)}
    ├─ Volume: $${signal.volumeUsd.toLocaleString()}
    └─ Tx Count: ${signal.txCount}
  
  Multipliers:
    ├─ Route Confidence: ${calc.routeConfidence.toFixed(3)}
    ├─ Market Modifier: ${calc.marketModifier.toFixed(3)}
    ├─ Data Quality: ${calc.dataQuality.toFixed(3)}
    └─ Actor Reliability: ${calc.actorReliability.toFixed(3)}
  
  Final Raw Weight: ${calc.rawWeight.toFixed(4)}
  Overall Confidence: ${calc.confidence.toFixed(3)}
  `.trim();
}

/**
 * Check if edge should be filtered out
 * 
 * Edges with zero weight or very low confidence can be hidden
 * 
 * @param weight - Edge weight
 * @param confidence - Edge confidence
 * @param minConfidence - Minimum confidence threshold
 * @returns True if edge should be filtered
 */
export function shouldFilterEdge(
  weight: number,
  confidence: number,
  minConfidence: number = 0.01
): boolean {
  return weight === 0 || confidence < minConfidence;
}
