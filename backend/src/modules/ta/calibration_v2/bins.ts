/**
 * Phase I: Binning and Isotonic Smoothing
 * 
 * Creates calibration bins from outcome data and applies isotonic regression
 */

import { CalibrationBin, CalibrationDataPoint, CalibrationConfig, DEFAULT_CALIBRATION_CONFIG } from './calibration_types.js';

/**
 * Build raw bins from data points
 */
export function buildRawBins(
  data: CalibrationDataPoint[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibrationBin[] {
  if (data.length === 0) return [];

  const binCount = config.binCount;
  const binSize = 1.0 / binCount;
  
  const bins: CalibrationBin[] = [];
  
  for (let i = 0; i < binCount; i++) {
    const minScore = i * binSize;
    const maxScore = (i + 1) * binSize;
    const midScore = (minScore + maxScore) / 2;
    
    // Filter data points in this bin
    const inBin = data.filter(d => {
      if (i === binCount - 1) {
        // Last bin includes upper bound
        return d.rawScore >= minScore && d.rawScore <= maxScore;
      }
      return d.rawScore >= minScore && d.rawScore < maxScore;
    });
    
    const count = inBin.length;
    const wins = inBin.filter(d => d.outcome === 'WIN').length;
    const winRate = count > 0 ? wins / count : 0;
    
    bins.push({
      minScore,
      maxScore,
      midScore,
      count,
      wins,
      winRate,
      calibratedP: winRate, // Initial, before smoothing
    });
  }
  
  return bins;
}

/**
 * Apply isotonic regression smoothing
 * 
 * Ensures monotonic non-decreasing probability curve
 */
export function applyIsotonicSmoothing(bins: CalibrationBin[]): CalibrationBin[] {
  if (bins.length === 0) return bins;
  
  // Pool Adjacent Violators Algorithm (PAVA)
  const result = bins.map(b => ({ ...b }));
  
  let i = 0;
  while (i < result.length) {
    let j = i;
    
    // Find a block of bins to pool
    while (j + 1 < result.length && result[j + 1].winRate < result[j].winRate) {
      j++;
    }
    
    if (j > i) {
      // Pool bins from i to j
      let totalCount = 0;
      let totalWins = 0;
      
      for (let k = i; k <= j; k++) {
        totalCount += result[k].count;
        totalWins += result[k].wins;
      }
      
      const pooledRate = totalCount > 0 ? totalWins / totalCount : 0;
      
      for (let k = i; k <= j; k++) {
        result[k].calibratedP = pooledRate;
      }
      
      i = j + 1;
    } else {
      result[i].calibratedP = result[i].winRate;
      i++;
    }
  }
  
  return result;
}

/**
 * Apply windowed smoothing for sparse bins
 */
export function applyWindowedSmoothing(
  bins: CalibrationBin[],
  windowSize: number = 3,
  minSamplesPerBin: number = 5
): CalibrationBin[] {
  if (bins.length === 0) return bins;
  
  const result = bins.map(b => ({ ...b }));
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let i = 0; i < result.length; i++) {
    if (result[i].count >= minSamplesPerBin) {
      // Bin has enough samples, keep its value
      continue;
    }
    
    // Sparse bin - use weighted average from neighbors
    let totalWeight = 0;
    let weightedSum = 0;
    
    for (let j = Math.max(0, i - halfWindow); j <= Math.min(result.length - 1, i + halfWindow); j++) {
      const weight = bins[j].count;
      if (weight > 0) {
        totalWeight += weight;
        weightedSum += bins[j].calibratedP * weight;
      }
    }
    
    if (totalWeight > 0) {
      result[i].calibratedP = weightedSum / totalWeight;
    }
  }
  
  return result;
}

/**
 * Full calibration pipeline: raw bins → isotonic → windowed smoothing
 */
export function buildCalibratedBins(
  data: CalibrationDataPoint[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibrationBin[] {
  const rawBins = buildRawBins(data, config);
  const isotonicBins = applyIsotonicSmoothing(rawBins);
  const smoothedBins = applyWindowedSmoothing(isotonicBins, config.smoothingWindow, config.minSamplesPerBin);
  
  return smoothedBins;
}

/**
 * Lookup probability from bins for a given score
 */
export function lookupProbability(score: number, bins: CalibrationBin[]): number | null {
  if (bins.length === 0) return null;
  
  // Find the bin containing this score
  for (const bin of bins) {
    if (score >= bin.minScore && score <= bin.maxScore) {
      return bin.calibratedP;
    }
  }
  
  // Score out of range - use boundary
  if (score < bins[0].minScore) {
    return bins[0].calibratedP;
  }
  if (score > bins[bins.length - 1].maxScore) {
    return bins[bins.length - 1].calibratedP;
  }
  
  return null;
}

/**
 * Calculate Expected Calibration Error (ECE)
 */
export function calculateECE(bins: CalibrationBin[]): number {
  if (bins.length === 0) return 0;
  
  const totalCount = bins.reduce((sum, b) => sum + b.count, 0);
  if (totalCount === 0) return 0;
  
  let ece = 0;
  
  for (const bin of bins) {
    if (bin.count === 0) continue;
    
    const weight = bin.count / totalCount;
    const error = Math.abs(bin.calibratedP - bin.winRate);
    ece += weight * error;
  }
  
  return ece;
}
