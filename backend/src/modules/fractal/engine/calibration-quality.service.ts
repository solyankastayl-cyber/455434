/**
 * BLOCK 38.4 — Calibration Quality Service
 * 
 * Computes calibration quality metrics:
 * - ECE (Expected Calibration Error)
 * - Brier Score
 * - Reliability curve bins
 */

import {
  CalibrationQualityReport,
  CalibrationQualityConfig,
  CalibrationBin,
  CalibrationQualityBadge,
  DEFAULT_CALIBRATION_QUALITY_CONFIG,
} from '../contracts/calibration-quality.contracts.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

interface CalibrationPoint {
  p: number;    // predicted confidence
  y: 0 | 1;     // actual outcome (1 = correct)
}

// ═══════════════════════════════════════════════════════════════
// Utilities
// ═══════════════════════════════════════════════════════════════

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

function determineBadge(
  ece: number,
  brier: number,
  n: number,
  cfg: CalibrationQualityConfig
): CalibrationQualityBadge {
  if (n < cfg.minSamples) return 'INSUFFICIENT_DATA';
  if (ece <= cfg.eceOk && brier <= cfg.brierOk) return 'OK';
  if (ece <= cfg.eceWarn && brier <= cfg.brierWarn) return 'WARN';
  if (ece <= cfg.eceDegraded && brier <= cfg.brierDegraded) return 'DEGRADED';
  return 'CRITICAL';
}

// ═══════════════════════════════════════════════════════════════
// Binning
// ═══════════════════════════════════════════════════════════════

/**
 * Build fixed-width bins
 */
function buildFixedBins(
  points: CalibrationPoint[],
  numBins: number
): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  
  for (let i = 0; i < numBins; i++) {
    const pMin = i / numBins;
    const pMax = (i + 1) / numBins;
    
    const inBin = points.filter(pt => pt.p >= pMin && pt.p < pMax);
    const n = inBin.length;
    const pAvg = n > 0 ? inBin.reduce((s, pt) => s + pt.p, 0) / n : (pMin + pMax) / 2;
    const hitRate = n > 0 ? inBin.reduce((s, pt) => s + pt.y, 0) / n : 0;
    
    bins.push({
      idx: i,
      n,
      pAvg: Math.round(pAvg * 1000) / 1000,
      hitRate: Math.round(hitRate * 1000) / 1000,
      gap: Math.round((hitRate - pAvg) * 1000) / 1000,
      pMin,
      pMax,
    });
  }
  
  return bins;
}

/**
 * Build quantile bins (equal sample size per bin)
 */
function buildQuantileBins(
  points: CalibrationPoint[],
  numBins: number
): CalibrationBin[] {
  if (points.length === 0) {
    return buildFixedBins([], numBins);
  }
  
  const sorted = [...points].sort((a, b) => a.p - b.p);
  const binSize = Math.ceil(sorted.length / numBins);
  const bins: CalibrationBin[] = [];
  
  for (let i = 0; i < numBins; i++) {
    const start = i * binSize;
    const end = Math.min((i + 1) * binSize, sorted.length);
    const inBin = sorted.slice(start, end);
    
    if (inBin.length === 0) continue;
    
    const n = inBin.length;
    const pMin = inBin[0].p;
    const pMax = inBin[inBin.length - 1].p;
    const pAvg = inBin.reduce((s, pt) => s + pt.p, 0) / n;
    const hitRate = inBin.reduce((s, pt) => s + pt.y, 0) / n;
    
    bins.push({
      idx: i,
      n,
      pAvg: Math.round(pAvg * 1000) / 1000,
      hitRate: Math.round(hitRate * 1000) / 1000,
      gap: Math.round((hitRate - pAvg) * 1000) / 1000,
      pMin: Math.round(pMin * 1000) / 1000,
      pMax: Math.round(pMax * 1000) / 1000,
    });
  }
  
  return bins;
}

// ═══════════════════════════════════════════════════════════════
// Main Computation
// ═══════════════════════════════════════════════════════════════

/**
 * Compute calibration quality report
 * 
 * @param points - array of (predicted, actual) pairs
 * @param mode - 'fixed' for fixed-width bins, 'quantile' for equal-N bins
 * @param cfg - configuration
 */
export function computeCalibrationQuality(
  points: CalibrationPoint[],
  mode: 'fixed' | 'quantile' = 'fixed',
  cfg: CalibrationQualityConfig = DEFAULT_CALIBRATION_QUALITY_CONFIG
): CalibrationQualityReport {
  // Filter valid points
  const pts = points
    .map(p => ({ p: clamp01(p.p), y: p.y }))
    .filter(p => Number.isFinite(p.p));
  
  const N = pts.length;
  
  if (N === 0) {
    return {
      sampleN: 0,
      ece: 0,
      brier: 0,
      badge: 'INSUFFICIENT_DATA',
      bins: [],
      monotonicityViolations: 0,
      coverage: { above60: 0, above70: 0, above80: 0 },
      updatedAtTs: Date.now(),
    };
  }
  
  // Build bins
  const bins = mode === 'quantile'
    ? buildQuantileBins(pts, cfg.numBins)
    : buildFixedBins(pts, cfg.numBins);
  
  // Compute ECE
  let ece = 0;
  for (const b of bins) {
    if (b.n === 0) continue;
    ece += (b.n / N) * Math.abs(b.hitRate - b.pAvg);
  }
  
  // Compute Brier score
  let brier = 0;
  for (const p of pts) {
    brier += (p.p - p.y) ** 2;
  }
  brier /= N;
  
  // Count monotonicity violations
  let violations = 0;
  let lastHitRate = -1;
  for (const b of bins.filter(b => b.n > 0)) {
    if (lastHitRate >= 0 && b.hitRate + 0.001 < lastHitRate) {
      violations++;
    }
    lastHitRate = b.hitRate;
  }
  
  // Coverage stats
  const above60 = pts.filter(p => p.p > 0.6).length / N;
  const above70 = pts.filter(p => p.p > 0.7).length / N;
  const above80 = pts.filter(p => p.p > 0.8).length / N;
  
  // Determine badge
  const badge = determineBadge(ece, brier, N, cfg);
  
  return {
    sampleN: N,
    ece: Math.round(ece * 10000) / 10000,
    brier: Math.round(brier * 10000) / 10000,
    badge,
    bins,
    monotonicityViolations: violations,
    coverage: {
      above60: Math.round(above60 * 1000) / 1000,
      above70: Math.round(above70 * 1000) / 1000,
      above80: Math.round(above80 * 1000) / 1000,
    },
    updatedAtTs: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Calibration Health Score
// ═══════════════════════════════════════════════════════════════

/**
 * Convert calibration quality to health score [0,1]
 * Used in reliability computation
 */
export function calibrationHealthScore(
  report: CalibrationQualityReport
): number {
  if (report.badge === 'INSUFFICIENT_DATA') {
    return 0.6; // neutral
  }
  
  // Score components
  const eceScore = Math.exp(-report.ece / 0.06);
  const brierScore = Math.exp(-(report.brier - 0.20) / 0.10);
  const violationScore = Math.exp(-report.monotonicityViolations / 3);
  
  // Weighted combination
  const score = 0.50 * eceScore + 0.35 * brierScore + 0.15 * violationScore;
  
  return Math.max(0, Math.min(1, score));
}

// ═══════════════════════════════════════════════════════════════
// Mock Data Generator (for testing)
// ═══════════════════════════════════════════════════════════════

/**
 * Generate mock calibration points
 * For testing the calibration quality computation
 */
export function generateMockCalibrationPoints(
  n: number,
  calibrationQuality: 'good' | 'medium' | 'bad' = 'medium'
): CalibrationPoint[] {
  const points: CalibrationPoint[] = [];
  
  for (let i = 0; i < n; i++) {
    const p = Math.random();
    
    let trueProb: number;
    switch (calibrationQuality) {
      case 'good':
        // Well-calibrated: true prob ≈ predicted
        trueProb = p + (Math.random() - 0.5) * 0.1;
        break;
      case 'medium':
        // Somewhat overconfident
        trueProb = p * 0.8 + 0.1;
        break;
      case 'bad':
        // Poorly calibrated
        trueProb = 0.5 + (Math.random() - 0.5) * 0.3;
        break;
    }
    
    trueProb = Math.max(0, Math.min(1, trueProb));
    const y: 0 | 1 = Math.random() < trueProb ? 1 : 0;
    
    points.push({ p, y });
  }
  
  return points;
}
