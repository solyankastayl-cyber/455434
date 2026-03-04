/**
 * S10.6I.6 — Indicator Snapshot Builder
 * 
 * Builds a complete snapshot of all 32 indicators for persistence.
 * Handles missing indicators gracefully (no errors, just tracking).
 */

import {
  IndicatorValue,
  IndicatorCategory,
  IndicatorInput,
  IndicatorSnapshot,
} from './indicator.types.js';
import * as registry from './indicator.registry.js';
import { StoredIndicatorValue, IndicatorsMeta } from '../observation/observation.types.js';

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const EXPECTED_INDICATOR_COUNT = 32;

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT RESULT
// ═══════════════════════════════════════════════════════════════

export interface IndicatorSnapshotForStorage {
  indicators: Record<string, StoredIndicatorValue>;
  meta: IndicatorsMeta;
}

// ═══════════════════════════════════════════════════════════════
// BUILD SNAPSHOT FOR STORAGE
// ═══════════════════════════════════════════════════════════════

export function buildIndicatorSnapshotForStorage(
  input: IndicatorInput,
  source: 'polling' | 'replay' | 'manual' = 'polling'
): IndicatorSnapshotForStorage {
  const startTime = Date.now();
  
  const indicators: Record<string, StoredIndicatorValue> = {};
  const missing: string[] = [];
  
  // Get all registered calculators
  const allDefinitions = registry.getAllDefinitions();
  
  for (const definition of allDefinitions) {
    try {
      const calculator = registry.getCalculator(definition.id);
      
      if (!calculator) {
        missing.push(definition.id);
        continue;
      }
      
      const result = calculator.calculate(input);
      
      // Validate result
      if (result && typeof result.value === 'number' && !isNaN(result.value)) {
        indicators[definition.id] = {
          value: result.value,
          category: result.category,
          normalized: result.normalized,
        };
      } else {
        missing.push(definition.id);
      }
    } catch (error) {
      // Don't throw — just track as missing
      missing.push(definition.id);
      console.warn(`[S10.6I.6] Failed to calculate ${definition.id}:`, error);
    }
  }
  
  const indicatorCount = Object.keys(indicators).length;
  const completeness = indicatorCount / EXPECTED_INDICATOR_COUNT;
  
  const meta: IndicatorsMeta = {
    completeness,
    indicatorCount,
    missing,
    source,
  };
  
  const elapsed = Date.now() - startTime;
  if (elapsed > 100) {
    console.warn(`[S10.6I.6] Slow indicator calculation: ${elapsed}ms`);
  }
  
  return { indicators, meta };
}

// ═══════════════════════════════════════════════════════════════
// VALIDATE INDICATORS
// ═══════════════════════════════════════════════════════════════

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateIndicators(
  indicators: Record<string, StoredIndicatorValue>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const count = Object.keys(indicators).length;
  
  // Check count
  if (count === 0) {
    errors.push('No indicators present');
  } else if (count < EXPECTED_INDICATOR_COUNT * 0.5) {
    warnings.push(`Low indicator count: ${count}/${EXPECTED_INDICATOR_COUNT}`);
  }
  
  // Check for NaN/undefined values
  for (const [id, indicator] of Object.entries(indicators)) {
    if (typeof indicator.value !== 'number' || isNaN(indicator.value)) {
      errors.push(`Invalid value for ${id}: ${indicator.value}`);
    }
    
    if (!indicator.category) {
      warnings.push(`Missing category for ${id}`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET INDICATOR BY CATEGORY
// ═══════════════════════════════════════════════════════════════

export function getIndicatorsByCategory(
  indicators: Record<string, StoredIndicatorValue>,
  category: IndicatorCategory
): Record<string, StoredIndicatorValue> {
  const result: Record<string, StoredIndicatorValue> = {};
  
  for (const [id, indicator] of Object.entries(indicators)) {
    if (indicator.category === category) {
      result[id] = indicator;
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════
// MERGE SNAPSHOTS (for backfill/updates)
// ═══════════════════════════════════════════════════════════════

export function mergeIndicatorSnapshots(
  existing: Record<string, StoredIndicatorValue>,
  incoming: Record<string, StoredIndicatorValue>
): Record<string, StoredIndicatorValue> {
  return {
    ...existing,
    ...incoming,
  };
}

console.log('[S10.6I.6] Indicator Snapshot Builder loaded');
