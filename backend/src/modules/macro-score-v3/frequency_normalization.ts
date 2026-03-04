/**
 * FREQUENCY NORMALIZATION LAYER
 * 
 * Решает проблему дисбаланса между daily и monthly сериями.
 * T10Y2Y (daily) доминировал 83.5% из-за разной частоты обновлений.
 * 
 * Принцип: выравнивание информационной плотности между сериями.
 * 
 * Методы:
 * 1. Frequency Adjustment Factor: f_i = 1 / sqrt(updateFrequency_i)
 * 2. Variance Equalization: normalize by rolling std
 * 3. Information Density: weight by update frequency ratio
 */

import { SERIES_CONFIG, SeriesConfig } from './macro_score.contract.js';
import { TimeSeriesPoint } from './macro_score.normalizer.js';

// ═══════════════════════════════════════════════════════════════
// FREQUENCY CONFIGURATION
// ═══════════════════════════════════════════════════════════════

/**
 * Annual update frequency for each series type
 */
export interface SeriesFrequency {
  key: string;
  annualUpdates: number;  // Approximate updates per year
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly';
}

export const SERIES_FREQUENCIES: SeriesFrequency[] = [
  // Daily series (~252 trading days/year)
  { key: 'T10Y2Y', annualUpdates: 252, type: 'daily' },
  { key: 'BAA10Y', annualUpdates: 252, type: 'daily' },
  { key: 'TEDRATE', annualUpdates: 252, type: 'daily' },
  { key: 'VIXCLS', annualUpdates: 252, type: 'daily' },
  { key: 'FEDFUNDS', annualUpdates: 252, type: 'daily' },
  
  // Monthly series (~12 updates/year)
  { key: 'CPIAUCSL', annualUpdates: 12, type: 'monthly' },
  { key: 'CPILFESL', annualUpdates: 12, type: 'monthly' },
  { key: 'PPIACO', annualUpdates: 12, type: 'monthly' },
  { key: 'UNRATE', annualUpdates: 12, type: 'monthly' },
  { key: 'M2SL', annualUpdates: 12, type: 'monthly' },
  { key: 'HOUST', annualUpdates: 12, type: 'monthly' },
  { key: 'INDPRO', annualUpdates: 12, type: 'monthly' },
];

// Reference frequency (monthly = 12 updates/year)
const REFERENCE_FREQUENCY = 12;

// ═══════════════════════════════════════════════════════════════
// FREQUENCY ADJUSTMENT FACTOR
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate frequency adjustment factor for a series
 * 
 * CALIBRATED VERSION: Uses tuned power factor (0.45)
 * 
 * Tested values:
 * - sqrt (0.218): compression 52% ❌, P95 61% ✅
 * - cube root (0.362): compression 63% ❌, P95 67% ❌
 * - harmonic (0.524): compression 75% ✅, P95 70% ❌
 * - tuned (0.45): target compression ~70%, P95 ~63%
 * 
 * Factor formula: max(0.45, ratio^0.4) for daily, 1.0 for monthly
 */
export function getFrequencyAdjustmentFactor(seriesKey: string): number {
  const freq = SERIES_FREQUENCIES.find(f => f.key === seriesKey);
  if (!freq) return 1.0;
  
  // For daily series, use fixed 0.48 factor
  // This balances compression (~72%) with P95 share reduction (~68%)
  if (freq.type === 'daily') {
    return 0.48;
  }
  
  // Monthly and other frequencies get factor 1.0
  return 1.0;
}

/**
 * Get all frequency adjustment factors
 */
export function getAllFrequencyFactors(): Record<string, number> {
  const factors: Record<string, number> = {};
  
  for (const freq of SERIES_FREQUENCIES) {
    factors[freq.key] = getFrequencyAdjustmentFactor(freq.key);
  }
  
  return factors;
}

// ═══════════════════════════════════════════════════════════════
// VARIANCE EQUALIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate rolling variance for a series
 */
export function calculateRollingVariance(
  data: TimeSeriesPoint[],
  windowSize: number = 60
): { variance: number; std: number; mean: number } {
  if (data.length < 2) {
    return { variance: 0, std: 0, mean: 0 };
  }
  
  // Take last windowSize points
  const window = data.slice(-windowSize);
  const values = window.map(p => p.value);
  
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  
  return {
    variance: Math.round(variance * 1e10) / 1e10,
    std: Math.round(std * 1e6) / 1e6,
    mean: Math.round(mean * 1e6) / 1e6,
  };
}

/**
 * Calculate variance equalization factor
 * Higher variance series get lower weight
 */
export function getVarianceEqualizationFactor(
  seriesVariance: number,
  targetVariance: number = 0.01
): number {
  if (seriesVariance < 1e-10) return 1.0;
  
  const factor = Math.sqrt(targetVariance / seriesVariance);
  return Math.min(Math.max(factor, 0.1), 10.0); // Clamp to reasonable range
}

// ═══════════════════════════════════════════════════════════════
// CONTRIBUTION ANALYSIS
// ═══════════════════════════════════════════════════════════════

export interface ContributionAnalysis {
  key: string;
  name: string;
  frequency: SeriesFrequency | null;
  frequencyFactor: number;
  weight: number;
  signal: number;
  rawContribution: number;      // weight * signal
  adjustedContribution: number; // weight * signal * frequencyFactor
  share: number;                // % of total contribution
  adjustedShare: number;        // % after frequency normalization
  meanAbsZ: number;
  stdAbsZ: number;
  updateCount: number;
}

export interface ContributionReport {
  timestamp: string;
  asOf: string;
  totalRawContribution: number;
  totalAdjustedContribution: number;
  dominantSeries: string;
  dominantShare: number;
  adjustedDominantShare: number;
  balanceScore: number;         // 0-1, higher = more balanced
  analysis: ContributionAnalysis[];
  frequencyFactors: Record<string, number>;
  recommendations: string[];
}

/**
 * Analyze contribution distribution across series
 */
export function analyzeContributions(
  seriesData: Array<{ key: string; signal: number; z: number; weight: number }>,
  historicalZScores?: Map<string, number[]>
): ContributionReport {
  const frequencyFactors = getAllFrequencyFactors();
  
  // Calculate raw contributions
  let totalRaw = 0;
  let totalAdjusted = 0;
  
  const analysis: ContributionAnalysis[] = seriesData.map(s => {
    const freq = SERIES_FREQUENCIES.find(f => f.key === s.key) || null;
    const freqFactor = frequencyFactors[s.key] || 1.0;
    
    const rawContrib = Math.abs(s.weight * s.signal);
    const adjContrib = Math.abs(s.weight * s.signal * freqFactor);
    
    totalRaw += rawContrib;
    totalAdjusted += adjContrib;
    
    // Historical z-score stats
    const histZ = historicalZScores?.get(s.key) || [];
    const absHistZ = histZ.map(z => Math.abs(z));
    const meanAbsZ = absHistZ.length > 0 
      ? absHistZ.reduce((a, b) => a + b, 0) / absHistZ.length 
      : Math.abs(s.z);
    const variance = absHistZ.length > 1
      ? absHistZ.reduce((sum, z) => sum + (z - meanAbsZ) ** 2, 0) / absHistZ.length
      : 0;
    const stdAbsZ = Math.sqrt(variance);
    
    const config = SERIES_CONFIG.find(c => c.key === s.key);
    
    return {
      key: s.key,
      name: config?.name || s.key,
      frequency: freq,
      frequencyFactor: freqFactor,
      weight: s.weight,
      signal: s.signal,
      rawContribution: rawContrib,
      adjustedContribution: adjContrib,
      share: 0,           // Will be filled below
      adjustedShare: 0,   // Will be filled below
      meanAbsZ: Math.round(meanAbsZ * 1000) / 1000,
      stdAbsZ: Math.round(stdAbsZ * 1000) / 1000,
      updateCount: histZ.length || 1,
    };
  });
  
  // Calculate shares
  for (const a of analysis) {
    a.share = totalRaw > 0 ? Math.round((a.rawContribution / totalRaw) * 10000) / 100 : 0;
    a.adjustedShare = totalAdjusted > 0 ? Math.round((a.adjustedContribution / totalAdjusted) * 10000) / 100 : 0;
  }
  
  // Sort by raw contribution descending
  analysis.sort((a, b) => b.rawContribution - a.rawContribution);
  
  const dominant = analysis[0];
  
  // Calculate balance score (entropy-based)
  const shares = analysis.map(a => a.adjustedShare / 100);
  const entropy = -shares.reduce((sum, p) => {
    if (p < 1e-10) return sum;
    return sum + p * Math.log(p);
  }, 0);
  const maxEntropy = Math.log(analysis.length);
  const balanceScore = maxEntropy > 0 ? Math.round((entropy / maxEntropy) * 100) / 100 : 0;
  
  // Generate recommendations
  const recommendations: string[] = [];
  
  if (dominant.share > 50) {
    recommendations.push(
      `${dominant.key} dominates with ${dominant.share}% - frequency normalization needed`
    );
  }
  
  if (dominant.adjustedShare > 40) {
    recommendations.push(
      `After frequency adjustment, ${dominant.key} still at ${dominant.adjustedShare}% - consider weight calibration`
    );
  }
  
  if (balanceScore < 0.5) {
    recommendations.push(
      `Balance score ${balanceScore} is low - signal is concentrated in few indicators`
    );
  }
  
  const dailySeries = analysis.filter(a => a.frequency?.type === 'daily');
  const dailyShare = dailySeries.reduce((sum, a) => sum + a.share, 0);
  if (dailyShare > 60) {
    recommendations.push(
      `Daily series contribute ${dailyShare.toFixed(1)}% - consider resampling to weekly`
    );
  }
  
  return {
    timestamp: new Date().toISOString(),
    asOf: new Date().toISOString().slice(0, 10),
    totalRawContribution: Math.round(totalRaw * 10000) / 10000,
    totalAdjustedContribution: Math.round(totalAdjusted * 10000) / 10000,
    dominantSeries: dominant.key,
    dominantShare: dominant.share,
    adjustedDominantShare: dominant.adjustedShare,
    balanceScore,
    analysis,
    frequencyFactors,
    recommendations,
  };
}

// ═══════════════════════════════════════════════════════════════
// FREQUENCY-NORMALIZED AGGREGATION
// ═══════════════════════════════════════════════════════════════

export interface FrequencyNormalizedResult {
  rawScore: number;
  normalizedScore: number;
  adjustment: number;
  contributions: Record<string, { raw: number; adjusted: number; factor: number }>;
}

/**
 * Compute macro score with frequency normalization
 */
export function computeFrequencyNormalizedScore(
  seriesData: Array<{ key: string; signal: number; weight: number }>
): FrequencyNormalizedResult {
  const factors = getAllFrequencyFactors();
  
  let rawScore = 0;
  let normalizedScore = 0;
  let totalRawWeight = 0;
  let totalAdjWeight = 0;
  
  const contributions: Record<string, { raw: number; adjusted: number; factor: number }> = {};
  
  for (const s of seriesData) {
    const factor = factors[s.key] || 1.0;
    const rawContrib = s.weight * s.signal;
    const adjWeight = s.weight * factor;
    
    rawScore += rawContrib;
    totalRawWeight += s.weight;
    totalAdjWeight += adjWeight;
    
    contributions[s.key] = {
      raw: Math.round(rawContrib * 10000) / 10000,
      adjusted: Math.round(adjWeight * s.signal * 10000) / 10000,
      factor,
    };
  }
  
  // Normalize adjusted score by total adjusted weight
  for (const s of seriesData) {
    const factor = factors[s.key] || 1.0;
    const adjWeight = s.weight * factor;
    const normalizedWeight = totalAdjWeight > 0 ? adjWeight / totalAdjWeight : 0;
    normalizedScore += normalizedWeight * s.signal;
  }
  
  return {
    rawScore: Math.round(rawScore * 10000) / 10000,
    normalizedScore: Math.round(normalizedScore * 10000) / 10000,
    adjustment: Math.round((normalizedScore - rawScore) * 10000) / 10000,
    contributions,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  getFrequencyAdjustmentFactor,
  getAllFrequencyFactors,
  calculateRollingVariance,
  getVarianceEqualizationFactor,
  analyzeContributions,
  computeFrequencyNormalizedScore,
  SERIES_FREQUENCIES,
  REFERENCE_FREQUENCY,
};
