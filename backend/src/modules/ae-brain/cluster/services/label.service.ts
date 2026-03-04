/**
 * Cluster Labeling Service
 * Assigns human-readable labels based on centroid values
 */

import type { DominantDim } from '../contracts/cluster.contract.js';
import { DIM_NAMES } from '../contracts/cluster.contract.js';

// ═══════════════════════════════════════════════════════════════
// LABEL TYPES
// ═══════════════════════════════════════════════════════════════

export type ClusterLabel =
  | 'RISK_OFF_STRESS'
  | 'LIQUIDITY_EXPANSION'
  | 'TIGHTENING_USD_SUPPORTIVE'
  | 'LOW_VOL_NEUTRAL'
  | 'DISINFLATION_EASING'
  | 'NEUTRAL_MIXED';

// ═══════════════════════════════════════════════════════════════
// LABEL DESCRIPTIONS
// ═══════════════════════════════════════════════════════════════

export const LABEL_DESCRIPTIONS: Record<ClusterLabel, string> = {
  'RISK_OFF_STRESS': 'High credit stress, elevated guard (crisis mode)',
  'LIQUIDITY_EXPANSION': 'Dovish macro, low stress, risk-on environment',
  'TIGHTENING_USD_SUPPORTIVE': 'Hawkish macro, strong USD momentum',
  'LOW_VOL_NEUTRAL': 'Low volatility, neutral signals',
  'DISINFLATION_EASING': 'Falling inflation pressure, dovish tilt',
  'NEUTRAL_MIXED': 'Mixed signals, no dominant regime',
};

// ═══════════════════════════════════════════════════════════════
// LABELING LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Assign label to cluster based on centroid
 * 
 * Centroid dimensions:
 * [0] macroSigned      - macro direction [-1..1]
 * [1] macroConfidence  - macro confidence [0..1]
 * [2] guardLevel       - stress level [0..1]
 * [3] dxySignalSigned  - DXY direction [-1..1]
 * [4] dxyConfidence    - DXY confidence [0..1]
 * [5] regimeBias90d    - 90d bias [-1..1]
 */
export function labelCluster(centroid: number[]): ClusterLabel {
  const macroSigned = centroid[0] ?? 0;
  const macroConfidence = centroid[1] ?? 0.5;
  const guardLevel = centroid[2] ?? 0;
  const dxySignalSigned = centroid[3] ?? 0;
  const dxyConfidence = centroid[4] ?? 0.5;
  const regimeBias = centroid[5] ?? 0;
  
  // RISK_OFF_STRESS: high guard level
  if (guardLevel > 0.4) {
    return 'RISK_OFF_STRESS';
  }
  
  // LIQUIDITY_EXPANSION: dovish macro + low stress + risk-on
  if (macroSigned < -0.10 && guardLevel < 0.15 && dxySignalSigned < 0) {
    return 'LIQUIDITY_EXPANSION';
  }
  
  // TIGHTENING_USD_SUPPORTIVE: hawkish macro + strong USD
  if (macroSigned > 0.10 && dxySignalSigned > 0.05) {
    return 'TIGHTENING_USD_SUPPORTIVE';
  }
  
  // DISINFLATION_EASING: dovish with weak USD
  if (macroSigned < -0.05 && dxySignalSigned < -0.05) {
    return 'DISINFLATION_EASING';
  }
  
  // LOW_VOL_NEUTRAL: all signals near zero
  if (
    Math.abs(macroSigned) < 0.08 &&
    Math.abs(dxySignalSigned) < 0.08 &&
    guardLevel < 0.10
  ) {
    return 'LOW_VOL_NEUTRAL';
  }
  
  // Default
  return 'NEUTRAL_MIXED';
}

/**
 * Get dominant dimensions of centroid
 */
export function dominantDims(centroid: number[], top: number = 2): DominantDim[] {
  const items = centroid.map((v, idx) => ({
    idx,
    name: DIM_NAMES[idx] || `dim${idx}`,
    value: Math.round(v * 1000) / 1000,
  }));
  
  // Sort by absolute value descending
  items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  
  return items.slice(0, top);
}
