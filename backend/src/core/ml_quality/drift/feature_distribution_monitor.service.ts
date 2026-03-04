/**
 * Feature Distribution Monitor (P0.7)
 * 
 * Tracks rolling statistics for drift pre-signals.
 * NO ML - just statistical monitoring.
 */

import { FeatureVector, FeatureKey, FeatureSource } from '../../ml_features_v2/types/feature.types.js';
import { FEATURE_REGISTRY } from '../../ml_features_v2/registry/feature_registry.js';
import {
  DriftAlertLevel,
  IFeatureDistribution,
  IDistributionDelta,
  saveDistribution,
  saveDelta,
  getLatestDistribution,
  getBaselineDistribution
} from '../storage/feature_distribution.model.js';

// ============================================
// Types
// ============================================

export interface DriftCheckResult {
  feature: string;
  source: string;
  baseline: {
    mean: number;
    std: number;
    sampleCount: number;
  } | null;
  current: {
    mean: number;
    std: number;
    sampleCount: number;
  };
  delta: {
    meanDelta: number;
    meanDeltaPct: number;
    zscore: number;
  } | null;
  alertLevel: DriftAlertLevel;
  message: string;
}

export interface BatchDriftResult {
  timestamp: Date;
  totalFeatures: number;
  featuresAnalyzed: number;
  alerts: DriftCheckResult[];
  summary: {
    info: number;
    warn: number;
    critical: number;
  };
}

// ============================================
// Thresholds
// ============================================

const DRIFT_THRESHOLDS = {
  // Z-score thresholds
  INFO_ZSCORE: 1.5,
  WARN_ZSCORE: 2.0,
  CRITICAL_ZSCORE: 3.0,
  
  // Percentage change thresholds
  INFO_PCT: 0.2,   // 20%
  WARN_PCT: 0.4,   // 40%
  CRITICAL_PCT: 0.6 // 60%
};

// ============================================
// Distribution Monitor
// ============================================

/**
 * Calculate distribution stats for a set of values
 */
export function calculateDistribution(values: number[]): Omit<IFeatureDistribution, 'featureKey' | 'source' | 'windowStart' | 'windowEnd' | 'createdAt'> {
  const filtered = values.filter(v => v !== null && !isNaN(v) && isFinite(v));
  const n = filtered.length;
  
  if (n === 0) {
    return {
      sampleCount: 0,
      mean: 0,
      std: 0,
      min: 0,
      max: 0,
      median: 0,
      p25: 0,
      p75: 0,
      nullCount: values.length,
      nullRatio: 1
    };
  }
  
  // Sort for percentiles
  const sorted = [...filtered].sort((a, b) => a - b);
  
  // Mean
  const mean = filtered.reduce((a, b) => a + b, 0) / n;
  
  // Standard deviation
  const variance = filtered.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const std = Math.sqrt(variance);
  
  // Min/Max
  const min = sorted[0];
  const max = sorted[n - 1];
  
  // Percentiles
  const median = sorted[Math.floor(n / 2)];
  const p25 = sorted[Math.floor(n * 0.25)];
  const p75 = sorted[Math.floor(n * 0.75)];
  
  return {
    sampleCount: n,
    mean: round(mean),
    std: round(std),
    min: round(min),
    max: round(max),
    median: round(median),
    p25: round(p25),
    p75: round(p75),
    nullCount: values.length - n,
    nullRatio: round((values.length - n) / values.length)
  };
}

/**
 * Check for drift in a single feature
 */
export async function checkFeatureDrift(
  featureKey: string,
  currentValues: number[],
  windowStart: Date,
  windowEnd: Date
): Promise<DriftCheckResult> {
  const def = FEATURE_REGISTRY[featureKey as FeatureKey];
  const source = def?.source || 'UNKNOWN';
  
  // Calculate current distribution
  const currentDist = calculateDistribution(currentValues);
  
  // Get baseline distribution
  const baseline = await getBaselineDistribution(featureKey, windowStart);
  
  // Determine alert level
  let alertLevel: DriftAlertLevel = 'INFO';
  let meanDelta = 0;
  let meanDeltaPct = 0;
  let zscore = 0;
  let message = '';
  
  if (!baseline || baseline.sampleCount < 10) {
    // No baseline - just record current, no drift signal
    message = 'No baseline data for comparison';
    
    // Save current as new distribution
    await saveDistribution({
      featureKey,
      source,
      windowStart,
      windowEnd,
      ...currentDist
    });
    
    return {
      feature: featureKey,
      source,
      baseline: null,
      current: {
        mean: currentDist.mean,
        std: currentDist.std,
        sampleCount: currentDist.sampleCount
      },
      delta: null,
      alertLevel,
      message
    };
  }
  
  // Calculate delta
  meanDelta = currentDist.mean - baseline.mean;
  meanDeltaPct = baseline.mean !== 0 ? meanDelta / Math.abs(baseline.mean) : 0;
  zscore = baseline.std > 0 ? meanDelta / baseline.std : 0;
  
  // Determine alert level based on thresholds
  const absZscore = Math.abs(zscore);
  const absPctChange = Math.abs(meanDeltaPct);
  
  if (absZscore >= DRIFT_THRESHOLDS.CRITICAL_ZSCORE || absPctChange >= DRIFT_THRESHOLDS.CRITICAL_PCT) {
    alertLevel = 'CRITICAL';
    message = `Critical drift detected: z-score=${round(zscore)}, change=${round(meanDeltaPct * 100)}%`;
  } else if (absZscore >= DRIFT_THRESHOLDS.WARN_ZSCORE || absPctChange >= DRIFT_THRESHOLDS.WARN_PCT) {
    alertLevel = 'WARN';
    message = `Warning: drift detected: z-score=${round(zscore)}, change=${round(meanDeltaPct * 100)}%`;
  } else if (absZscore >= DRIFT_THRESHOLDS.INFO_ZSCORE || absPctChange >= DRIFT_THRESHOLDS.INFO_PCT) {
    alertLevel = 'INFO';
    message = `Minor drift: z-score=${round(zscore)}, change=${round(meanDeltaPct * 100)}%`;
  } else {
    message = 'Within normal range';
  }
  
  // Save current distribution
  await saveDistribution({
    featureKey,
    source,
    windowStart,
    windowEnd,
    ...currentDist
  });
  
  // Save delta if there's drift
  if (alertLevel !== 'INFO' || absZscore > 1.0) {
    await saveDelta({
      featureKey,
      source,
      baselineWindowStart: baseline.windowStart,
      baselineWindowEnd: baseline.windowEnd,
      currentWindowStart: windowStart,
      currentWindowEnd: windowEnd,
      meanDelta: round(meanDelta),
      meanDeltaPct: round(meanDeltaPct),
      stdDelta: round(currentDist.std - baseline.std),
      stdDeltaPct: baseline.std > 0 ? round((currentDist.std - baseline.std) / baseline.std) : 0,
      zscore: round(zscore),
      alertLevel,
      triggeredThresholds: getTriggeredThresholds(absZscore, absPctChange),
      timestamp: new Date()
    });
  }
  
  return {
    feature: featureKey,
    source,
    baseline: {
      mean: baseline.mean,
      std: baseline.std,
      sampleCount: baseline.sampleCount
    },
    current: {
      mean: currentDist.mean,
      std: currentDist.std,
      sampleCount: currentDist.sampleCount
    },
    delta: {
      meanDelta: round(meanDelta),
      meanDeltaPct: round(meanDeltaPct),
      zscore: round(zscore)
    },
    alertLevel,
    message
  };
}

/**
 * Check drift across all features from multiple vectors
 */
export async function checkBatchDrift(
  vectors: FeatureVector[],
  windowStart: Date,
  windowEnd: Date
): Promise<BatchDriftResult> {
  const allKeys = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
  const alerts: DriftCheckResult[] = [];
  let featuresAnalyzed = 0;
  
  // Aggregate values per feature
  const featureValues: Record<string, number[]> = {};
  
  for (const vector of vectors) {
    const sources = ['routes', 'dex', 'actor', 'watchlist', 'system', 'market'] as const;
    
    for (const source of sources) {
      const features = vector[source] as Record<string, any> | undefined;
      if (!features) continue;
      
      for (const [key, value] of Object.entries(features)) {
        if (typeof value === 'number' && !isNaN(value)) {
          if (!featureValues[key]) featureValues[key] = [];
          featureValues[key].push(value);
        }
      }
    }
  }
  
  // Check drift for each feature with enough samples
  const summary = { info: 0, warn: 0, critical: 0 };
  
  for (const [featureKey, values] of Object.entries(featureValues)) {
    if (values.length < 5) continue; // Need minimum samples
    
    featuresAnalyzed++;
    const result = await checkFeatureDrift(featureKey, values, windowStart, windowEnd);
    
    // Only include non-trivial alerts
    if (result.alertLevel === 'WARN' || result.alertLevel === 'CRITICAL' || 
        (result.delta && Math.abs(result.delta.zscore) > 1.0)) {
      alerts.push(result);
    }
    
    summary[result.alertLevel.toLowerCase() as keyof typeof summary]++;
  }
  
  return {
    timestamp: new Date(),
    totalFeatures: allKeys.length,
    featuresAnalyzed,
    alerts: alerts.sort((a, b) => {
      // Sort by severity
      const order = { CRITICAL: 0, WARN: 1, INFO: 2 };
      return order[a.alertLevel] - order[b.alertLevel];
    }),
    summary
  };
}

// ============================================
// Helpers
// ============================================

function round(n: number, decimals: number = 4): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function getTriggeredThresholds(zscore: number, pct: number): string[] {
  const triggered: string[] = [];
  
  if (zscore >= DRIFT_THRESHOLDS.CRITICAL_ZSCORE) triggered.push('CRITICAL_ZSCORE');
  else if (zscore >= DRIFT_THRESHOLDS.WARN_ZSCORE) triggered.push('WARN_ZSCORE');
  else if (zscore >= DRIFT_THRESHOLDS.INFO_ZSCORE) triggered.push('INFO_ZSCORE');
  
  if (pct >= DRIFT_THRESHOLDS.CRITICAL_PCT) triggered.push('CRITICAL_PCT');
  else if (pct >= DRIFT_THRESHOLDS.WARN_PCT) triggered.push('WARN_PCT');
  else if (pct >= DRIFT_THRESHOLDS.INFO_PCT) triggered.push('INFO_PCT');
  
  return triggered;
}
