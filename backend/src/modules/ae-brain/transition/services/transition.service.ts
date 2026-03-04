/**
 * C8 Transition Matrix Service
 * Computes regime transition probabilities P(regime_{t+1} | regime_t)
 */

import type {
  TransitionConfig,
  TransitionMatrix,
  TransitionMeta,
  DerivedMetrics,
  StressRisk,
  DurationStats,
} from '../contracts/transition.contract.js';
import { TransitionMatrixModel } from '../storage/transition.model.js';
import { getClusterTimeline, getLatestRun, getCurrentCluster } from '../../cluster/services/cluster.service.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

// Labels considered as "stress" regimes
const STRESS_LABELS = ['RISK_OFF_STRESS', 'CRISIS', 'BLOCK'];

// ═══════════════════════════════════════════════════════════════
// HELPER: Matrix multiplication
// ═══════════════════════════════════════════════════════════════

function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  const result: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        result[i][j] += A[i][k] * B[k][j];
      }
    }
  }
  
  return result;
}

/**
 * Compute matrix power T^k
 */
function matrixPower(T: number[][], k: number): number[][] {
  const n = T.length;
  
  // Identity matrix
  let result: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );
  
  let base = T.map(row => [...row]);
  
  while (k > 0) {
    if (k % 2 === 1) {
      result = matrixMultiply(result, base);
    }
    base = matrixMultiply(base, base);
    k = Math.floor(k / 2);
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Compute Transition Matrix
// ═══════════════════════════════════════════════════════════════

/**
 * Compute transition probability matrix from cluster timeline
 */
export async function computeTransitionMatrix(
  config: TransitionConfig
): Promise<TransitionMatrix> {
  const { from, to, stepDays, alpha } = config;
  
  console.log(`[Transition] Computing matrix: ${from} → ${to}, step=${stepDays}d, alpha=${alpha}`);
  
  // Get cluster timeline
  const timeline = await getClusterTimeline(from, to);
  if (!timeline || timeline.points.length < 2) {
    throw new Error('Not enough data points for transition matrix');
  }
  
  const points = timeline.points;
  console.log(`[Transition] Timeline has ${points.length} points`);
  
  // Get unique labels
  const labelSet = new Set<string>();
  for (const p of points) {
    labelSet.add(p.label);
  }
  const labels = Array.from(labelSet).sort();
  const n = labels.length;
  
  console.log(`[Transition] Found ${n} labels: ${labels.join(', ')}`);
  
  // Create label -> index map
  const labelIndex = new Map<string, number>();
  labels.forEach((label, idx) => labelIndex.set(label, idx));
  
  // Count transitions
  const counts: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let samples = 0;
  
  for (let i = 0; i < points.length - 1; i++) {
    const fromLabel = points[i].label;
    const toLabel = points[i + 1].label;
    
    const fromIdx = labelIndex.get(fromLabel);
    const toIdx = labelIndex.get(toLabel);
    
    if (fromIdx !== undefined && toIdx !== undefined) {
      counts[fromIdx][toIdx] += 1;
      samples++;
    }
  }
  
  console.log(`[Transition] Counted ${samples} transitions`);
  
  // Apply Laplace smoothing and normalize to probabilities
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const rowSums: number[] = new Array(n).fill(0);
  
  for (let i = 0; i < n; i++) {
    // Add alpha smoothing to all cells
    let rowSum = 0;
    for (let j = 0; j < n; j++) {
      const smoothedCount = counts[i][j] + alpha;
      rowSum += smoothedCount;
    }
    
    // Normalize to probabilities
    for (let j = 0; j < n; j++) {
      matrix[i][j] = (counts[i][j] + alpha) / rowSum;
      matrix[i][j] = Math.round(matrix[i][j] * 10000) / 10000; // 4 decimals
    }
    
    // Verify row sum
    rowSums[i] = matrix[i].reduce((s, v) => s + v, 0);
  }
  
  const meta: TransitionMeta = {
    from,
    to,
    stepDays,
    alpha,
    samples,
    labels,
    computedAt: new Date().toISOString(),
  };
  
  // Save to database
  const matrixId = `${new Date().toISOString()}_step${stepDays}_alpha${alpha}`;
  
  await TransitionMatrixModel.findOneAndUpdate(
    { matrixId },
    {
      matrixId,
      ...meta,
      matrix,
      rowSums,
      computedAt: new Date(),
    },
    { upsert: true }
  );
  
  console.log(`[Transition] Saved matrix ${matrixId}`);
  
  return {
    meta,
    matrix,
    rowSums,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET LATEST MATRIX
// ═══════════════════════════════════════════════════════════════

export async function getLatestMatrix(): Promise<TransitionMatrix | null> {
  const doc = await TransitionMatrixModel.findOne().sort({ computedAt: -1 }).lean();
  if (!doc) return null;
  
  return {
    meta: {
      from: doc.from,
      to: doc.to,
      stepDays: doc.stepDays,
      alpha: doc.alpha,
      samples: doc.samples,
      labels: doc.labels,
      computedAt: doc.computedAt.toISOString(),
    },
    matrix: doc.matrix,
    rowSums: doc.rowSums,
  };
}

// ═══════════════════════════════════════════════════════════════
// DERIVED METRICS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute derived metrics for current regime
 */
export async function computeDerivedMetrics(
  matrix: TransitionMatrix,
  currentLabel?: string
): Promise<DerivedMetrics> {
  const { labels } = matrix.meta;
  const n = labels.length;
  
  // Get current label if not provided
  let currentLbl = currentLabel;
  if (!currentLbl) {
    const current = await getCurrentCluster();
    currentLbl = current?.label || labels[0];
  }
  
  const currentIdx = labels.indexOf(currentLbl);
  if (currentIdx === -1) {
    throw new Error(`Current label ${currentLbl} not in matrix labels`);
  }
  
  // Find stress label indices
  const stressLabels = labels.filter(l => STRESS_LABELS.includes(l));
  const stressIndices = stressLabels.map(l => labels.indexOf(l)).filter(i => i >= 0);
  
  // Compute multi-step stress risk
  const T1 = matrix.matrix;
  const T2 = matrixPower(T1, 2);
  const T4 = matrixPower(T1, 4);
  
  const sumStressProb = (M: number[][], fromIdx: number): number => {
    let sum = 0;
    for (const toIdx of stressIndices) {
      sum += M[fromIdx][toIdx];
    }
    return Math.round(sum * 10000) / 10000;
  };
  
  const p1w = sumStressProb(T1, currentIdx);
  const p2w = sumStressProb(T2, currentIdx);
  const p4w = sumStressProb(T4, currentIdx);
  
  // Most likely next regime
  let maxProb = 0;
  let maxIdx = 0;
  for (let j = 0; j < n; j++) {
    if (T1[currentIdx][j] > maxProb) {
      maxProb = T1[currentIdx][j];
      maxIdx = j;
    }
  }
  
  // Self-transition probability
  const selfProb = T1[currentIdx][currentIdx];
  
  return {
    stressLabels,
    currentLabel: currentLbl,
    riskToStress: {
      label: currentLbl,
      p1w,
      p2w,
      p4w,
    },
    mostLikelyNext: labels[maxIdx],
    mostLikelyNextProb: Math.round(maxProb * 10000) / 10000,
    selfTransitionProb: Math.round(selfProb * 10000) / 10000,
  };
}

// ═══════════════════════════════════════════════════════════════
// DURATION ANALYSIS
// ═══════════════════════════════════════════════════════════════

/**
 * Compute regime duration statistics
 */
export async function computeDurationStats(
  from: string = '2000-01-01',
  to: string = '2025-12-31'
): Promise<DurationStats[]> {
  const timeline = await getClusterTimeline(from, to);
  if (!timeline || timeline.points.length < 2) {
    return [];
  }
  
  const points = timeline.points;
  
  // Track episodes for each label
  const episodes: Map<string, number[]> = new Map();
  
  let currentLabel = points[0].label;
  let currentDuration = 1;
  
  for (let i = 1; i < points.length; i++) {
    if (points[i].label === currentLabel) {
      currentDuration++;
    } else {
      // Episode ended
      if (!episodes.has(currentLabel)) {
        episodes.set(currentLabel, []);
      }
      episodes.get(currentLabel)!.push(currentDuration);
      
      currentLabel = points[i].label;
      currentDuration = 1;
    }
  }
  
  // Don't forget last episode
  if (!episodes.has(currentLabel)) {
    episodes.set(currentLabel, []);
  }
  episodes.get(currentLabel)!.push(currentDuration);
  
  // Compute stats for each label
  const stats: DurationStats[] = [];
  
  for (const [label, durations] of episodes.entries()) {
    if (durations.length === 0) continue;
    
    const sorted = [...durations].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    
    stats.push({
      label,
      count: durations.length,
      medianWeeks: median,
      meanWeeks: Math.round((sum / durations.length) * 10) / 10,
      p90Weeks: p90,
      maxWeeks: sorted[sorted.length - 1],
    });
  }
  
  // Sort by count descending
  stats.sort((a, b) => b.count - a.count);
  
  return stats;
}

// ═══════════════════════════════════════════════════════════════
// FULL TRANSITION PACK (for AE Terminal)
// ═══════════════════════════════════════════════════════════════

export interface TransitionPack {
  matrix: TransitionMatrix;
  derived: DerivedMetrics;
  durations: DurationStats[];
}

/**
 * Get full transition analysis pack
 */
export async function getTransitionPack(currentLabel?: string): Promise<TransitionPack | null> {
  const matrix = await getLatestMatrix();
  if (!matrix) return null;
  
  const derived = await computeDerivedMetrics(matrix, currentLabel);
  const durations = await computeDurationStats();
  
  return {
    matrix,
    derived,
    durations,
  };
}
