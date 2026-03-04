/**
 * Feature Normalization (P0.6)
 * 
 * Normalizes feature values for ML consumption.
 */

import {
  FeatureVector,
  FeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { FEATURE_REGISTRY, FeatureDefinition } from '../registry/feature_registry.js';

// ============================================
// Types
// ============================================

export interface NormalizationResult {
  normalized: FeatureVector;
  stats: {
    normalized: number;
    skipped: number;
    errors: string[];
  };
}

// ============================================
// Normalization Functions
// ============================================

/**
 * Apply min-max normalization
 * Maps value to [0, 1] range
 */
function normalizeMinMax(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  const normalized = (value - min) / (max - min);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Apply z-score normalization
 * Assumes mean=0, std=1 for typical z-score range
 * Clips to [-3, 3] then maps to [0, 1]
 */
function normalizeZscore(value: number): number {
  const clipped = Math.max(-3, Math.min(3, value));
  return (clipped + 3) / 6; // Maps [-3, 3] to [0, 1]
}

/**
 * Apply log normalization
 * Uses log(1 + value) and clips to reasonable range
 */
function normalizeLog(value: number, maxLog: number = 10): number {
  if (value <= 0) return 0;
  const logValue = Math.log(1 + value);
  return Math.min(1, logValue / maxLog);
}

/**
 * Normalize a single feature value
 */
function normalizeFeature(
  key: FeatureKey,
  value: FeatureValue,
  def: FeatureDefinition
): FeatureValue {
  // Handle null/undefined
  if (value === null || value === undefined) {
    return null;
  }
  
  // Handle boolean - no normalization needed
  if (def.valueType === 'boolean') {
    return value;
  }
  
  // Handle number
  if (typeof value !== 'number' || isNaN(value)) {
    return null;
  }
  
  const normConfig = def.normalization;
  
  // No normalization
  if (!normConfig || normConfig.method === 'none') {
    return value;
  }
  
  // Apply normalization based on method
  switch (normConfig.method) {
    case 'minmax': {
      const min = normConfig.params?.min ?? def.range?.min ?? 0;
      const max = normConfig.params?.max ?? def.range?.max ?? 1;
      return Math.round(normalizeMinMax(value, min, max) * 1000) / 1000;
    }
    
    case 'zscore': {
      return Math.round(normalizeZscore(value) * 1000) / 1000;
    }
    
    case 'log': {
      const maxLog = normConfig.params?.maxLog ?? 10;
      return Math.round(normalizeLog(value, maxLog) * 1000) / 1000;
    }
    
    default:
      return value;
  }
}

// ============================================
// Main Normalization
// ============================================

/**
 * Normalize entire feature vector
 */
export function normalizeFeatureVector(vector: FeatureVector): NormalizationResult {
  const normalized: FeatureVector = {
    ...vector,
    routes: {},
    dex: {},
    market: {},
    actor: {},
    watchlist: {},
    system: {}
  };
  
  let normalizedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  
  // Process each feature source
  const sources = ['routes', 'dex', 'market', 'actor', 'watchlist', 'system'] as const;
  
  for (const source of sources) {
    const features = vector[source];
    if (!features) continue;
    
    for (const [key, value] of Object.entries(features)) {
      const featureKey = key as FeatureKey;
      const def = FEATURE_REGISTRY[featureKey];
      
      if (!def) {
        errors.push(`Unknown feature: ${key}`);
        skippedCount++;
        (normalized[source] as any)[key] = value;
        continue;
      }
      
      try {
        const normalizedValue = normalizeFeature(featureKey, value, def);
        (normalized[source] as any)[key] = normalizedValue;
        
        if (normalizedValue !== value) {
          normalizedCount++;
        }
      } catch (err) {
        errors.push(`Normalization error for ${key}: ${(err as Error).message}`);
        (normalized[source] as any)[key] = value;
        skippedCount++;
      }
    }
  }
  
  return {
    normalized,
    stats: {
      normalized: normalizedCount,
      skipped: skippedCount,
      errors
    }
  };
}

/**
 * Convert feature vector to flat array for ML
 * Returns array in consistent order based on registry
 */
export function vectorToArray(vector: FeatureVector): number[] {
  const result: number[] = [];
  
  // Get all keys in consistent order
  const allKeys = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
  
  for (const key of allKeys) {
    const def = FEATURE_REGISTRY[key];
    let value: number;
    
    // Get value from appropriate source
    const sourceFeatures = vector[def.source.toLowerCase() as keyof FeatureVector];
    const rawValue = (sourceFeatures as any)?.[key];
    
    // Convert to number
    if (rawValue === null || rawValue === undefined) {
      value = -1; // Sentinel for null
    } else if (typeof rawValue === 'boolean') {
      value = rawValue ? 1 : 0;
    } else if (typeof rawValue === 'number') {
      value = isNaN(rawValue) ? -1 : rawValue;
    } else {
      value = -1;
    }
    
    result.push(value);
  }
  
  return result;
}

/**
 * Get feature names in array order
 */
export function getFeatureNames(): string[] {
  return Object.keys(FEATURE_REGISTRY);
}
