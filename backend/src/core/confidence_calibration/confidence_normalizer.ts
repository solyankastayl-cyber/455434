/**
 * P2.2 Phase 1: Confidence Normalizer
 * 
 * Quantile-based normalization.
 *
 * Why NOT linear:
 * - Linear explodes on whales
 * - Quantile preserves ordering & hierarchy
 *
 * Guarantees:
 * - Monotonic (order preserved)
 * - Stable across datasets
 * - Deterministic
 */

import {
  CalibratedEdge,
  CalibratedNode,
  CalibrationConfig,
  DEFAULT_CALIBRATION_CONFIG,
} from './types.js';

// ═══════════════════════════════════════════════════════════════════════════
// QUANTILE SCALER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a quantile scaler function
 * 
 * Maps values to their percentile position in the distribution
 * 
 * @param values - Array of values to build distribution from
 * @param min - Minimum output value
 * @param max - Maximum output value
 * @returns Function that scales any value to [min, max]
 */
function buildQuantileScaler(
  values: number[],
  min: number,
  max: number
): (value: number) => number {
  if (values.length === 0) {
    return () => min;
  }
  
  // Sort values
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  
  // Single value
  if (n === 1) {
    return () => max;
  }
  
  // Return scaler function
  return (value: number) => {
    // Handle edges
    if (value <= sorted[0]) return min;
    if (value >= sorted[n - 1]) return max;
    
    // Find position in sorted array
    let idx = 0;
    while (idx < n && sorted[idx] < value) {
      idx++;
    }
    
    // Calculate percentile [0..1]
    const percentile = idx / (n - 1);
    
    // Map to output range
    return min + percentile * (max - min);
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize edge weights using quantile strategy
 * 
 * Preserves order and hierarchy while mapping to target range
 * 
 * @param edges - Calibrated edges (with raw weights)
 * @param config - Calibration configuration
 * @returns Edges with normalized weights
 */
export function normalizeEdgeWeights(
  edges: CalibratedEdge[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibratedEdge[] {
  if (edges.length === 0) return edges;
  
  const weights = edges.map(e => e.weight);
  const scaler = buildQuantileScaler(
    weights,
    config.weightRange.min,
    config.weightRange.max
  );
  
  return edges.map(edge => ({
    ...edge,
    weight: scaler(edge.weight),
  }));
}

/**
 * Normalize node size weights using quantile strategy
 * 
 * @param nodes - Calibrated nodes (with raw size weights)
 * @param config - Calibration configuration
 * @returns Nodes with normalized size weights
 */
export function normalizeNodeWeights(
  nodes: CalibratedNode[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibratedNode[] {
  if (nodes.length === 0) return nodes;
  
  const sizeWeights = nodes.map(n => n.sizeWeight);
  const scaler = buildQuantileScaler(
    sizeWeights,
    config.weightRange.min,
    config.weightRange.max
  );
  
  return nodes.map(node => ({
    ...node,
    sizeWeight: scaler(node.sizeWeight),
  }));
}

/**
 * Test if normalization preserves order
 * 
 * @param originalWeights - Original weight values
 * @param normalizedWeights - Normalized weight values
 * @returns True if order is preserved
 */
export function verifyMonotonicity(
  originalWeights: number[],
  normalizedWeights: number[]
): boolean {
  if (originalWeights.length !== normalizedWeights.length) {
    return false;
  }
  
  for (let i = 0; i < originalWeights.length - 1; i++) {
    const origOrder = originalWeights[i] <= originalWeights[i + 1];
    const normOrder = normalizedWeights[i] <= normalizedWeights[i + 1];
    
    if (origOrder !== normOrder) {
      return false;
    }
  }
  
  return true;
}
