/**
 * BLOCK 73.2 — Divergence Engine
 * 
 * Calculates divergence metrics between synthetic forecast and primary match replay.
 * 
 * Metrics:
 * - RMSE: Root mean square error on returns
 * - MAPE: Mean absolute percentage error
 * - MaxAbsDev: Maximum absolute deviation
 * - TerminalDelta: End-point divergence
 * - DirectionalMismatch: % of days with opposite direction
 * - Correlation: Pearson correlation on daily increments
 * 
 * Score: 0-100 composite (higher = better alignment)
 * Grade: A/B/C/D/F based on score
 * Flags: Warning indicators for specific issues
 */

import type { 
  DivergenceMetrics, 
  DivergenceGrade, 
  DivergenceFlag,
  AxisMode 
} from '../focus/focus.types.js';

// ═══════════════════════════════════════════════════════════════
// TIER-SPECIFIC WEIGHTS
// ═══════════════════════════════════════════════════════════════

interface DivergenceWeights {
  rmse: number;
  mape: number;
  maxAbsDev: number;
  terminalDelta: number;
  directionalMismatch: number;
  corrPenalty: number; // (1 - corr) penalty
}

const TIER_WEIGHTS: Record<'TIMING' | 'TACTICAL' | 'STRUCTURE', DivergenceWeights> = {
  TIMING: {
    rmse: 0.15,
    mape: 0.15,
    maxAbsDev: 0.10,
    terminalDelta: 0.30,      // High: end result matters for timing
    directionalMismatch: 0.20, // High: direction matters
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
    corrPenalty: 0.25,        // High: correlation matters for structure
  },
};

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS FOR FLAGS
// ═══════════════════════════════════════════════════════════════

const THRESHOLDS = {
  HIGH_DIVERGENCE_RMSE: 15,   // % RMSE
  LOW_CORR: 0.3,              // Correlation below this
  TERM_DRIFT: 20,             // % terminal delta
  DIR_MISMATCH: 55,           // % directional mismatch
  PERFECT_MATCH_RMSE: 1,      // % RMSE for perfect match
};

// ═══════════════════════════════════════════════════════════════
// MAIN CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate divergence metrics between synthetic and replay series
 * 
 * @param syntheticPath - Synthetic forecast prices (raw or normalized)
 * @param replayPath - Primary match replay prices (raw or normalized)
 * @param basePrice - Current price (NOW)
 * @param horizonDays - Number of forecast days
 * @param tier - TIMING/TACTICAL/STRUCTURE
 * @param mode - RAW or PERCENT
 */
export function calculateDivergence(
  syntheticPath: number[],
  replayPath: number[],
  basePrice: number,
  horizonDays: number,
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE',
  mode: AxisMode
): DivergenceMetrics {
  // Align series lengths
  const len = Math.min(syntheticPath.length, replayPath.length, horizonDays);
  
  if (len < 2 || basePrice <= 0) {
    return createEmptyMetrics(horizonDays, mode);
  }
  
  // Convert to returns space: r_t = (p_t - p_0) / p_0 * 100 (in %)
  const synReturns = syntheticPath.slice(0, len).map(p => ((p / basePrice) - 1) * 100);
  const repReturns = replayPath.slice(0, len).map(p => ((p / basePrice) - 1) * 100);
  
  // Calculate metrics
  const rmse = calcRMSE(synReturns, repReturns);
  const mape = calcMAPE(synReturns, repReturns);
  const maxAbsDev = calcMaxAbsDev(synReturns, repReturns);
  const terminalDelta = calcTerminalDelta(synReturns, repReturns);
  const directionalMismatch = calcDirectionalMismatch(synReturns, repReturns);
  const corr = calcPearsonCorrelation(synReturns, repReturns);
  
  // Calculate composite score
  const weights = TIER_WEIGHTS[tier];
  const score = calcCompositeScore(
    rmse, mape, maxAbsDev, terminalDelta, directionalMismatch, corr,
    weights
  );
  
  // Determine grade
  const grade = getGrade(score);
  
  // Determine flags
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
  const epsilon = 0.01; // Avoid division by zero
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
  // Return difference as percentage points
  return synEnd - repEnd;
}

function calcDirectionalMismatch(syn: number[], rep: number[]): number {
  if (syn.length < 2) return 0;
  
  let mismatchCount = 0;
  for (let i = 1; i < syn.length; i++) {
    const synDelta = syn[i] - syn[i - 1];
    const repDelta = rep[i] - rep[i - 1];
    
    // Check if directions differ (one positive, one negative)
    if ((synDelta > 0 && repDelta < 0) || (synDelta < 0 && repDelta > 0)) {
      mismatchCount++;
    }
  }
  
  return (mismatchCount / (syn.length - 1)) * 100;
}

function calcPearsonCorrelation(syn: number[], rep: number[]): number {
  const n = syn.length;
  if (n < 3) return 0;
  
  // Calculate means
  const synMean = syn.reduce((a, b) => a + b, 0) / n;
  const repMean = rep.reduce((a, b) => a + b, 0) / n;
  
  // Calculate correlation
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
  if (denominator < 1e-10) return 1; // Both series constant = perfect correlation
  
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
  // Normalize metrics to 0-100 penalty scale
  const rmsePenalty = Math.min(100, rmse * 3);           // 33% RMSE = 100 penalty
  const mapePenalty = Math.min(100, mape);               // 100% MAPE = 100 penalty
  const maxDevPenalty = Math.min(100, maxAbsDev * 2);    // 50% max dev = 100 penalty
  const termPenalty = Math.min(100, Math.abs(terminalDelta) * 3); // 33% terminal diff = 100
  const dirPenalty = directionalMismatch;                // Already in %
  const corrPenalty = Math.max(0, (1 - corr) * 50);      // corr=0 = 50 penalty
  
  // Weighted penalty
  const totalPenalty = 
    (rmsePenalty * weights.rmse) +
    (mapePenalty * weights.mape) +
    (maxDevPenalty * weights.maxAbsDev) +
    (termPenalty * weights.terminalDelta) +
    (dirPenalty * weights.directionalMismatch) +
    (corrPenalty * weights.corrPenalty);
  
  // Score = 100 - penalty, clamped
  return Math.max(0, Math.min(100, 100 - totalPenalty));
}

// ═══════════════════════════════════════════════════════════════
// GRADE & FLAGS
// ═══════════════════════════════════════════════════════════════

function getGrade(score: number): DivergenceGrade {
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
): DivergenceFlag[] {
  const flags: DivergenceFlag[] = [];
  
  if (rmse <= THRESHOLDS.PERFECT_MATCH_RMSE) {
    flags.push('PERFECT_MATCH');
    return flags; // No warnings if perfect
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

function createEmptyMetrics(horizonDays: number, mode: AxisMode): DivergenceMetrics {
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
