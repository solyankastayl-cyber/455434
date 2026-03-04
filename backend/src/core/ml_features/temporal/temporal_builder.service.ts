/**
 * Temporal Feature Builder
 * 
 * EPIC 7: Builds temporal features from Engine aggregates
 * 
 * Input: Engine aggregate history
 * Output: Temporal feature vector for ML (SHADOW only)
 * 
 * DOES NOT:
 * - Access Tokens/Wallets directly
 * - Trigger training
 * - Modify decisions
 */

import type {
  TemporalWindow,
  TemporalFeatures,
  WindowedTemporalFeatures,
  MetricTemporalFeatures,
  TemporalFeatureVector,
  TemporalSample,
  TimeSeriesPoint,
  TemporalMetric,
} from './temporal.types.js';

import {
  TEMPORAL_WINDOWS,
  TEMPORAL_METRICS,
  WINDOW_HOURS,
} from './temporal.types.js';

import {
  safeCalculateFeatures,
  filterToWindow,
  extractValues,
} from './temporal_calculations.service.js';

import { v4 as uuidv4 } from 'uuid';

/**
 * Build temporal features for all windows of a metric
 */
export function buildWindowedFeatures(
  series: TimeSeriesPoint[],
  referenceTime?: Date
): WindowedTemporalFeatures {
  const result = {} as WindowedTemporalFeatures;
  
  for (const window of TEMPORAL_WINDOWS) {
    const windowPoints = filterToWindow(series, WINDOW_HOURS[window], referenceTime);
    const values = extractValues(windowPoints);
    result[window] = safeCalculateFeatures(values);
  }
  
  return result;
}

/**
 * Build temporal features for all metrics
 */
export function buildMetricFeatures(
  history: Map<TemporalMetric, TimeSeriesPoint[]>,
  referenceTime?: Date
): Partial<MetricTemporalFeatures> {
  const result: Partial<MetricTemporalFeatures> = {};
  
  for (const metric of TEMPORAL_METRICS) {
    const series = history.get(metric);
    if (series && series.length > 0) {
      result[metric] = buildWindowedFeatures(series, referenceTime);
    }
  }
  
  return result;
}

/**
 * Flatten temporal features to ML-ready vector
 * Format: {metric}_{window}_{feature}
 */
export function flattenToVector(
  metrics: Partial<MetricTemporalFeatures>
): TemporalFeatureVector {
  const vector: TemporalFeatureVector = {};
  
  for (const [metric, windowed] of Object.entries(metrics)) {
    if (!windowed) continue;
    
    for (const [window, features] of Object.entries(windowed)) {
      const prefix = `${metric}_${window}`;
      
      vector[`${prefix}_delta`] = features.delta;
      vector[`${prefix}_deltaPct`] = features.deltaPct;
      vector[`${prefix}_slope`] = features.slope;
      vector[`${prefix}_acceleration`] = features.acceleration;
      vector[`${prefix}_consistency`] = features.consistency;
      vector[`${prefix}_regime`] = features.regime;
    }
  }
  
  return vector;
}

/**
 * Build complete temporal sample
 */
export function buildTemporalSample(
  tokenAddress: string,
  history: Map<TemporalMetric, TimeSeriesPoint[]>,
  options?: {
    signalId?: string;
    referenceTime?: Date;
  }
): TemporalSample {
  const metrics = buildMetricFeatures(history, options?.referenceTime);
  const featureVector = flattenToVector(metrics);
  
  return {
    sampleId: uuidv4(),
    tokenAddress,
    signalId: options?.signalId,
    createdAt: new Date(),
    metrics,
    featureVector,
    gateVersion: 'EPIC_7',
    sourceVersion: '1.0.0',
  };
}

/**
 * Get list of all feature names (for schema validation)
 */
export function getTemporalFeatureNames(): string[] {
  const names: string[] = [];
  
  for (const metric of TEMPORAL_METRICS) {
    for (const window of TEMPORAL_WINDOWS) {
      const prefix = `${metric}_${window}`;
      names.push(
        `${prefix}_delta`,
        `${prefix}_deltaPct`,
        `${prefix}_slope`,
        `${prefix}_acceleration`,
        `${prefix}_consistency`,
        `${prefix}_regime`,
      );
    }
  }
  
  return names;
}

/**
 * Validate temporal feature vector has all required fields
 */
export function validateFeatureVector(vector: TemporalFeatureVector): {
  valid: boolean;
  missingFields: string[];
} {
  const requiredFields = getTemporalFeatureNames();
  const missingFields = requiredFields.filter(f => !(f in vector));
  
  return {
    valid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Check for invalid values (NaN, Infinity)
 */
export function checkForInvalidValues(vector: TemporalFeatureVector): {
  valid: boolean;
  invalidFields: string[];
} {
  const invalidFields: string[] = [];
  
  for (const [key, value] of Object.entries(vector)) {
    if (typeof value === 'number') {
      if (!isFinite(value) || isNaN(value)) {
        invalidFields.push(key);
      }
    }
  }
  
  return {
    valid: invalidFields.length === 0,
    invalidFields,
  };
}
