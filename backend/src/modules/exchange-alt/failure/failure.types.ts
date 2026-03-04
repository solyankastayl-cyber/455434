/**
 * BLOCK 18 — Failure Taxonomy
 * ============================
 * 
 * Classify WHY the system fails, not just that it fails.
 */

import type { ShadowOutcome, ShadowTrade } from '../shadow/shadow.types.js';

// ═══════════════════════════════════════════════════════════════
// FAILURE CLASSES
// ═══════════════════════════════════════════════════════════════

export type FailureClass = 
  | 'REGIME_MISMATCH'
  | 'VOLATILITY_SHOCK'
  | 'FUNDING_TRAP'
  | 'LIQUIDITY_MIRAGE'
  | 'CLUSTER_OVERFIT'
  | 'TIMING_ERROR'
  | 'UNKNOWN';

export interface FailedTrade {
  tradeId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  horizon: string;
  pnlPct: number;
  
  // Context at failure
  marketRegime: string;
  volatilityBucket: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
  fundingState: 'POSITIVE' | 'NEGATIVE' | 'EXTREME_POS' | 'EXTREME_NEG' | 'NEUTRAL';
  oiState: 'RISING' | 'FALLING' | 'FLAT';
  
  clusterId: string;
  topFeatures: string[];
  
  // Classification
  failureClass: FailureClass;
  doNotTrain: boolean;
  recommendedAction: 'WEIGHT_ADJUST' | 'FREEZE_PATTERN' | 'IGNORE' | 'RETRAIN';
  
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// FAILURE INSIGHT
// ═══════════════════════════════════════════════════════════════

export interface FailureInsight {
  failureClass: FailureClass;
  frequency: number;
  avgLoss: number;
  affectedAssets: string[];
  affectedClusters: string[];
  recommendation: string;
}

// ═══════════════════════════════════════════════════════════════
// FAILURE HEATMAP
// ═══════════════════════════════════════════════════════════════

export interface FailureHeatmap {
  matrix: Record<string, Record<string, {
    label: 'TP' | 'FP' | 'WEAK';
    count: number;
    avgReturn: number;
  }>>;
  rows: string[];  // Funding states
  cols: string[];  // Regimes
}

// ═══════════════════════════════════════════════════════════════
// CLASSIFICATION RULES
// ═══════════════════════════════════════════════════════════════

export const FAILURE_RULES = {
  regimeMismatch: {
    regimeChanged: true,
    volSpike: true,
  },
  fundingTrap: {
    fundingExtreme: true,
    squeezeOccurred: true,
  },
  liquidityMirage: {
    oiDrop: true,
    volumeFake: true,
  },
  clusterOverfit: {
    consecutiveFP: 3,
    sameCluster: true,
  },
} as const;

/**
 * Classify failure based on context
 */
export function classifyFailure(
  trade: ShadowTrade,
  outcome: ShadowOutcome,
  context: {
    regimeChanged: boolean;
    volSpike: boolean;
    fundingExtreme: boolean;
    squeezeOccurred: boolean;
    oiDrop: boolean;
    volumeFake: boolean;
    consecutiveFPsInCluster: number;
  }
): FailureClass {
  // Regime Mismatch
  if (context.regimeChanged && context.volSpike) {
    return 'REGIME_MISMATCH';
  }
  
  // Volatility Shock
  if (context.volSpike && !context.regimeChanged) {
    return 'VOLATILITY_SHOCK';
  }
  
  // Funding Trap
  if (context.fundingExtreme && context.squeezeOccurred) {
    return 'FUNDING_TRAP';
  }
  
  // Liquidity Mirage
  if (context.oiDrop && context.volumeFake) {
    return 'LIQUIDITY_MIRAGE';
  }
  
  // Cluster Overfit
  if (context.consecutiveFPsInCluster >= FAILURE_RULES.clusterOverfit.consecutiveFP) {
    return 'CLUSTER_OVERFIT';
  }
  
  // Timing Error (direction right, timing wrong)
  if (Math.abs(outcome.pnlPct) < 2) {
    return 'TIMING_ERROR';
  }
  
  return 'UNKNOWN';
}

/**
 * Get recommended action for failure class
 */
export function getRecommendedAction(
  failureClass: FailureClass
): { doNotTrain: boolean; action: FailedTrade['recommendedAction'] } {
  switch (failureClass) {
    case 'REGIME_MISMATCH':
      return { doNotTrain: true, action: 'IGNORE' };
    case 'VOLATILITY_SHOCK':
      return { doNotTrain: true, action: 'IGNORE' };
    case 'FUNDING_TRAP':
      return { doNotTrain: false, action: 'WEIGHT_ADJUST' };
    case 'LIQUIDITY_MIRAGE':
      return { doNotTrain: true, action: 'IGNORE' };
    case 'CLUSTER_OVERFIT':
      return { doNotTrain: false, action: 'FREEZE_PATTERN' };
    case 'TIMING_ERROR':
      return { doNotTrain: false, action: 'RETRAIN' };
    default:
      return { doNotTrain: false, action: 'RETRAIN' };
  }
}

console.log('[Block18] Failure Taxonomy Types loaded');
