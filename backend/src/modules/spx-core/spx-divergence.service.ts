/**
 * SPX CORE — Divergence Service
 * 
 * BLOCK B5.2.4 — Divergence Calculation Engine
 * 
 * Calculates divergence metrics between synthetic forecast and primary match replay.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

import type { SpxHorizonTier } from './spx-primary-selector.service.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SpxAxisMode = 'RAW' | 'PERCENT';
export type SpxDivergenceGrade = 'A' | 'B' | 'C' | 'D' | 'F';
export type SpxDivergenceFlag = 
  | 'PERFECT_MATCH'
  | 'HIGH_DIVERGENCE'
  | 'LOW_CORR'
  | 'TERM_DRIFT'
  | 'DIR_MISMATCH';

export interface SpxDivergenceMetrics {
  horizonDays: number;
  mode: SpxAxisMode;
  rmse: number;              // Root mean square error on returns
  mape: number;              // Mean absolute percentage error
  maxAbsDev: number;         // Maximum absolute deviation
  terminalDelta: number;     // End-point divergence
  directionalMismatch: number; // % of days with opposite direction
  corr: number;              // Pearson correlation
  score: number;             // 0-100 composite score
  grade: SpxDivergenceGrade;
  flags: SpxDivergenceFlag[];
  samplePoints: number;
}

// ═══════════════════════════════════════════════════════════════
// TIER-SPECIFIC WEIGHTS
// ═══════════════════════════════════════════════════════════════

interface DivergenceWeights {
  rmse: number;
  mape: number;
  maxAbsDev: number;
  terminalDelta: number;
  directionalMismatch: number;
  corrPenalty: number;
}

const TIER_WEIGHTS: Record<SpxHorizonTier, DivergenceWeights> = {
  TIMING: {
    rmse: 0.15,
    mape: 0.15,
    maxAbsDev: 0.10,
    terminalDelta: 0.30,
    directionalMismatch: 0.20,
    corrPenalty: 0.10,
  },
  TACTICAL: {
    rmse: 0.20,
    mape: 0.20,
    maxAbsDev: 0.15,
    terminalDelta: 0.20,
    directionalMismatch: 0.15,
    corrPenalty: 0.10,
  },
  STRUCTURE: {
    rmse: 0.25,
    mape: 0.15,
    maxAbsDev: 0.10,
    terminalDelta: 0.15,
    directionalMismatch: 0.10,
    corrPenalty: 0.25,
  },
};

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS FOR FLAGS
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  HIGH_DIVERGENCE_RMSE: 15,
  LOW_CORR: 0.3,
  TERM_DRIFT: 20,
  DIR_MISMATCH: 55,
  PERFECT_MATCH_RMSE: 1,
};

// ═══════════════════════════════════════════════════════════════
// MAIN CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate divergence metrics between synthetic and replay series
 */
export function calculateDivergence(
  syntheticPath: number[],
  replayPath: number[],
  basePrice: number,
  horizonDays: number,
  tier: SpxHorizonTier,
  mode: SpxAxisMode = 'RAW'
): SpxDivergenceMetrics {
  // Align series lengths
  const len = Math.min(syntheticPath.length, replayPath.length, horizonDays);
  
  if (len < 2 || basePrice <= 0) {
    return createEmptyMetrics(horizonDays, mode);
  }
  
  // Convert to returns space: r_t = (p_t - p_0) / p_0 * 100 (%)
  const synReturns = syntheticPath.slice(0, len).map(p => ((p / basePrice) - 1) * 100);
  const repReturns = replayPath.slice(0, len).map(p => ((p / basePrice) - 1) * 100);
  
  // Calculate metrics
  const rmse = calcRMSE(synReturns, repReturns);
  const mape = calcMAPE(synReturns, repReturns);
  const maxAbsDev = calcMaxAbsDev(synReturns, repReturns);
  const terminalDelta = calcTerminalDelta(synReturns, repReturns);
  const directionalMismatch = calcDirectionalMismatch(synReturns, repReturns);
  const corr = calcPearsonCorrelation(synReturns, repReturns);
  
  // Composite score
  const weights = TIER_WEIGHTS[tier];
  const score = calcCompositeScore(
    rmse, mape, maxAbsDev, terminalDelta, directionalMismatch, corr,
    weights
  );
  
  const grade = getGrade(score);
  const flags = getFlags(rmse, corr, terminalDelta, directionalMismatch);
  
  return {
    horizonDays,
    mode,
    rmse: round(rmse, 2),
    mape: round(mape, 2),
    maxAbsDev: round(maxAbsDev, 2),
    terminalDelta: round(terminalDelta, 2),
    directionalMismatch: round(directionalMismatch, 1),
    corr: round(corr, 3),
    score: Math.round(score),
    grade,
    flags,
    samplePoints: len,
  };
}

// ═══════════════════════════════════════════════════════════════
// METRIC CALCULATIONS
// ═══════════════════════════════════════════════════════════════

function calcRMSE(syn: number[], rep: number[]): number {
  if (syn.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < syn.length; i++) {
    const diff = syn[i] - rep[i];
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / syn.length);
}

function calcMAPE(syn: number[], rep: number[]): number {
  if (syn.length === 0) return 0;
  const epsilon = 0.01;
  let sumAbs = 0;
  for (let i = 0; i < syn.length; i++) {
    const denom = Math.max(epsilon, Math.abs(rep[i]) + epsilon);
    sumAbs += Math.abs(syn[i] - rep[i]) / denom;
  }
  return (sumAbs / syn.length) * 100;
}

function calcMaxAbsDev(syn: number[], rep: number[]): number {
  if (syn.length === 0) return 0;
  let maxDev = 0;
  for (let i = 0; i < syn.length; i++) {
    const dev = Math.abs(syn[i] - rep[i]);
    if (dev > maxDev) maxDev = dev;
  }
  return maxDev;
}

function calcTerminalDelta(syn: number[], rep: number[]): number {
  if (syn.length === 0) return 0;
  const synEnd = syn[syn.length - 1];
  const repEnd = rep[rep.length - 1];
  return synEnd - repEnd;
}

function calcDirectionalMismatch(syn: number[], rep: number[]): number {
  if (syn.length < 2) return 0;
  
  let mismatchCount = 0;
  for (let i = 1; i < syn.length; i++) {
    const synDelta = syn[i] - syn[i - 1];
    const repDelta = rep[i] - rep[i - 1];
    
    if ((synDelta > 0 && repDelta < 0) || (synDelta < 0 && repDelta > 0)) {
      mismatchCount++;
    }
  }
  
  return (mismatchCount / (syn.length - 1)) * 100;
}

function calcPearsonCorrelation(syn: number[], rep: number[]): number {
  const n = syn.length;
  if (n < 3) return 0;
  
  const synMean = syn.reduce((a, b) => a + b, 0) / n;
  const repMean = rep.reduce((a, b) => a + b, 0) / n;
  
  let numerator = 0;
  let synVar = 0;
  let repVar = 0;
  
  for (let i = 0; i < n; i++) {
    const synDiff = syn[i] - synMean;
    const repDiff = rep[i] - repMean;
    numerator += synDiff * repDiff;
    synVar += synDiff * synDiff;
    repVar += repDiff * repDiff;
  }
  
  const denominator = Math.sqrt(synVar * repVar);
  if (denominator < 1e-10) return 1;
  
  return numerator / denominator;
}

// ═══════════════════════════════════════════════════════════════
// COMPOSITE SCORE
// ═══════════════════════════════════════════════════════════════

function calcCompositeScore(
  rmse: number,
  mape: number,
  maxAbsDev: number,
  terminalDelta: number,
  directionalMismatch: number,
  corr: number,
  weights: DivergenceWeights
): number {
  const rmsePenalty = Math.min(100, rmse * 3);
  const mapePenalty = Math.min(100, mape);
  const maxDevPenalty = Math.min(100, maxAbsDev * 2);
  const termPenalty = Math.min(100, Math.abs(terminalDelta) * 3);
  const dirPenalty = directionalMismatch;
  const corrPenalty = Math.max(0, (1 - corr) * 50);
  
  const totalPenalty = 
    (rmsePenalty * weights.rmse) +
    (mapePenalty * weights.mape) +
    (maxDevPenalty * weights.maxAbsDev) +
    (termPenalty * weights.terminalDelta) +
    (dirPenalty * weights.directionalMismatch) +
    (corrPenalty * weights.corrPenalty);
  
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

// ═══════════════════════════════════════════════════════════════
// GRADE & FLAGS
// ═══════════════════════════════════════════════════════════════

function getGrade(score: number): SpxDivergenceGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

function getFlags(
  rmse: number,
  corr: number,
  terminalDelta: number,
  directionalMismatch: number
): SpxDivergenceFlag[] {
  const flags: SpxDivergenceFlag[] = [];
  
  if (rmse <= THRESHOLDS.PERFECT_MATCH_RMSE) {
    flags.push('PERFECT_MATCH');
    return flags;
  }
  
  if (rmse > THRESHOLDS.HIGH_DIVERGENCE_RMSE) {
    flags.push('HIGH_DIVERGENCE');
  }
  
  if (corr < THRESHOLDS.LOW_CORR) {
    flags.push('LOW_CORR');
  }
  
  if (Math.abs(terminalDelta) > THRESHOLDS.TERM_DRIFT) {
    flags.push('TERM_DRIFT');
  }
  
  if (directionalMismatch > THRESHOLDS.DIR_MISMATCH) {
    flags.push('DIR_MISMATCH');
  }
  
  return flags;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function round(value: number, decimals: number): number {
  const mult = Math.pow(10, decimals);
  return Math.round(value * mult) / mult;
}

function createEmptyMetrics(horizonDays: number, mode: SpxAxisMode): SpxDivergenceMetrics {
  return {
    horizonDays,
    mode,
    rmse: 0,
    mape: 0,
    maxAbsDev: 0,
    terminalDelta: 0,
    directionalMismatch: 0,
    corr: 1,
    score: 100,
    grade: 'A',
    flags: [],
    samplePoints: 0,
  };
}

export default { calculateDivergence };
