/**
 * Calibration Engine — Reliability Curve Builder
 * 
 * Phase 6: Calibration Layer
 * 
 * Builds reliability bins from historical data:
 * - Divides score range (0-1) into bins
 * - Calculates actual win rate for each bin
 * - Enables score → probability mapping
 */

import { CalibrationDataPoint } from './calibration.dataset.js';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type CalibrationBin = {
  range: [number, number];  // [min, max)
  predictions: number;
  wins: number;
  losses: number;
  timeouts: number;
  winRate: number;
  avgReturnPct: number;
};

export type CalibrationResult = {
  bins: CalibrationBin[];
  totalRecords: number;
  overallWinRate: number;
  overallAvgReturn: number;
  calibrationError: number;  // ECE (Expected Calibration Error)
  reliability: 'GOOD' | 'MODERATE' | 'POOR' | 'INSUFFICIENT';
  generatedAt: string;
};

export type CalibrationConfig = {
  numBins: number;          // Default 10 (0.1 step)
  minSamplesPerBin: number; // Minimum samples for reliable estimate
};

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  numBins: 10,
  minSamplesPerBin: 5,
};

// ═══════════════════════════════════════════════════════════════
// Calibration Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Build calibration bins from dataset
 */
export function buildCalibrationBins(
  records: CalibrationDataPoint[],
  config: Partial<CalibrationConfig> = {}
): CalibrationBin[] {
  const cfg = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  const step = 1 / cfg.numBins;

  // Initialize bins
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < cfg.numBins; i++) {
    bins.push({
      range: [i * step, (i + 1) * step],
      predictions: 0,
      wins: 0,
      losses: 0,
      timeouts: 0,
      winRate: 0,
      avgReturnPct: 0,
    });
  }

  // Populate bins
  for (const r of records) {
    const score = r.score ?? 0;
    const idx = Math.min(cfg.numBins - 1, Math.floor(score * cfg.numBins));
    
    bins[idx].predictions++;
    
    if (r.result === 'WIN') bins[idx].wins++;
    if (r.result === 'LOSS') bins[idx].losses++;
    if (r.result === 'TIMEOUT') bins[idx].timeouts++;
    
    // Track returns for average
    if (r.returnPct !== undefined) {
      bins[idx].avgReturnPct += r.returnPct;
    }
  }

  // Calculate rates
  for (const bin of bins) {
    const decisive = bin.wins + bin.losses;
    bin.winRate = decisive > 0 ? bin.wins / decisive : 0;
    
    if (bin.predictions > 0 && bin.avgReturnPct !== 0) {
      bin.avgReturnPct = bin.avgReturnPct / bin.predictions;
    }
    
    // Round to 2 decimals
    bin.winRate = Math.round(bin.winRate * 100) / 100;
    bin.avgReturnPct = Math.round(bin.avgReturnPct * 100) / 100;
  }

  return bins;
}

/**
 * Build full calibration result with statistics
 */
export function buildCalibrationResult(
  records: CalibrationDataPoint[],
  config: Partial<CalibrationConfig> = {}
): CalibrationResult {
  const cfg = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  const bins = buildCalibrationBins(records, cfg);

  // Overall statistics
  const wins = records.filter(r => r.result === 'WIN').length;
  const losses = records.filter(r => r.result === 'LOSS').length;
  const decisive = wins + losses;
  
  const overallWinRate = decisive > 0 ? wins / decisive : 0;
  const overallAvgReturn = records.length > 0
    ? records.reduce((s, r) => s + (r.returnPct || 0), 0) / records.length
    : 0;

  // Calculate ECE (Expected Calibration Error)
  // ECE = Σ (n_bin / N) * |accuracy_bin - confidence_bin|
  let ece = 0;
  for (const bin of bins) {
    if (bin.predictions > 0 && records.length > 0) {
      const midpoint = (bin.range[0] + bin.range[1]) / 2;
      const weight = bin.predictions / records.length;
      const error = Math.abs(bin.winRate - midpoint);
      ece += weight * error;
    }
  }

  // Determine reliability level
  let reliability: 'GOOD' | 'MODERATE' | 'POOR' | 'INSUFFICIENT';
  if (records.length < 50) {
    reliability = 'INSUFFICIENT';
  } else if (ece < 0.05) {
    reliability = 'GOOD';
  } else if (ece < 0.10) {
    reliability = 'MODERATE';
  } else {
    reliability = 'POOR';
  }

  return {
    bins,
    totalRecords: records.length,
    overallWinRate: Math.round(overallWinRate * 100) / 100,
    overallAvgReturn: Math.round(overallAvgReturn * 100) / 100,
    calibrationError: Math.round(ece * 1000) / 1000,
    reliability,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Calibrate a single score to probability
 */
export function calibrateScore(
  score: number,
  bins: CalibrationBin[]
): number {
  if (bins.length === 0) return score;

  // Find matching bin
  for (const bin of bins) {
    if (score >= bin.range[0] && score < bin.range[1]) {
      // If bin has data, use calibrated win rate
      if (bin.predictions > 0) {
        return bin.winRate;
      }
      break;
    }
  }

  // Fallback to raw score
  return score;
}

/**
 * Calibrate multiple patterns with confidence intervals
 */
export function calibratePatterns(
  patterns: Array<{ score: number; [key: string]: any }>,
  bins: CalibrationBin[]
): Array<{
  originalScore: number;
  calibratedProbability: number;
  sampleSize: number;
  binReliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  [key: string]: any;
}> {
  return patterns.map(p => {
    const score = p.score ?? 0;
    const calibrated = calibrateScore(score, bins);
    
    // Find bin for reliability info
    let sampleSize = 0;
    let binReliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' = 'NONE';
    
    for (const bin of bins) {
      if (score >= bin.range[0] && score < bin.range[1]) {
        sampleSize = bin.predictions;
        if (sampleSize >= 50) binReliability = 'HIGH';
        else if (sampleSize >= 20) binReliability = 'MEDIUM';
        else if (sampleSize > 0) binReliability = 'LOW';
        break;
      }
    }

    return {
      ...p,
      originalScore: score,
      calibratedProbability: calibrated,
      sampleSize,
      binReliability,
    };
  });
}
