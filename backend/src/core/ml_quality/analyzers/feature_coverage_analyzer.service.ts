/**
 * Feature Coverage Analyzer (P0.7)
 * 
 * Calculates coverage statistics from feature vectors.
 * Deterministic rules only - no ML.
 */

import { FeatureVector, FeatureSource, FeatureKey } from '../../ml_features_v2/types/feature.types.js';
import { FEATURE_REGISTRY, getCriticalFeatures } from '../../ml_features_v2/registry/feature_registry.js';
import { ICoverageStats, ISourceCoverage } from '../storage/feature_coverage.model.js';

// ============================================
// Types
// ============================================

export interface CoverageAnalysisResult {
  coverage: ICoverageStats;
  bySource: Record<FeatureSource, ISourceCoverage>;
  missingCritical: string[];
  details: {
    presentFeatures: string[];
    missingFeatures: string[];
    nullFeatures: string[];
  };
}

// ============================================
// Coverage Analyzer
// ============================================

/**
 * Analyze coverage of a feature vector
 */
export function analyzeCoverage(vector: FeatureVector): CoverageAnalysisResult {
  const presentFeatures: string[] = [];
  const missingFeatures: string[] = [];
  const nullFeatures: string[] = [];
  const missingCritical: string[] = [];
  
  // Initialize source stats
  const bySource: Record<FeatureSource, ISourceCoverage> = {
    ROUTES: { total: 0, present: 0, missing: 0, ratio: 0 },
    DEX: { total: 0, present: 0, missing: 0, ratio: 0 },
    MARKET: { total: 0, present: 0, missing: 0, ratio: 0 },
    ACTOR: { total: 0, present: 0, missing: 0, ratio: 0 },
    WATCHLIST: { total: 0, present: 0, missing: 0, ratio: 0 },
    SYSTEM: { total: 0, present: 0, missing: 0, ratio: 0 }
  };
  
  // Analyze each feature in registry
  const allKeys = Object.keys(FEATURE_REGISTRY) as FeatureKey[];
  
  for (const key of allKeys) {
    const def = FEATURE_REGISTRY[key];
    const source = def.source;
    
    // Increment total for source
    bySource[source].total++;
    
    // Get value from vector
    const sourceKey = source.toLowerCase() as keyof FeatureVector;
    const sourceFeatures = vector[sourceKey] as Record<string, any> | undefined;
    const value = sourceFeatures?.[key];
    
    // Check if present
    const isPresent = value !== null && value !== undefined;
    const isNull = value === null;
    
    if (isPresent) {
      presentFeatures.push(key);
      bySource[source].present++;
    } else {
      missingFeatures.push(key);
      bySource[source].missing++;
      
      if (isNull) {
        nullFeatures.push(key);
      }
      
      // Check if critical
      if (def.critical) {
        missingCritical.push(key);
      }
    }
  }
  
  // Calculate ratios
  for (const source of Object.keys(bySource) as FeatureSource[]) {
    const stats = bySource[source];
    stats.ratio = stats.total > 0 ? stats.present / stats.total : 0;
    stats.ratio = Math.round(stats.ratio * 100) / 100;
  }
  
  // Calculate overall stats
  const totalFeatures = allKeys.length;
  const coverage: ICoverageStats = {
    totalFeatures,
    presentFeatures: presentFeatures.length,
    missingFeatures: missingFeatures.length,
    coverageRatio: totalFeatures > 0 
      ? Math.round((presentFeatures.length / totalFeatures) * 100) / 100 
      : 0,
    nullRatio: totalFeatures > 0 
      ? Math.round((nullFeatures.length / totalFeatures) * 100) / 100 
      : 0
  };
  
  return {
    coverage,
    bySource,
    missingCritical,
    details: {
      presentFeatures,
      missingFeatures,
      nullFeatures
    }
  };
}

/**
 * Check if coverage meets minimum thresholds
 */
export function checkCoverageThresholds(
  result: CoverageAnalysisResult,
  thresholds: {
    totalCoverage?: number;
    routesCoverage?: number;
    dexCoverage?: number;
    actorCoverage?: number;
    maxMissingCritical?: number;
  } = {}
): {
  passed: boolean;
  failures: string[];
} {
  const {
    totalCoverage = 0.75,
    routesCoverage = 0.70,
    dexCoverage = 0.50,
    actorCoverage = 0.30,
    maxMissingCritical = 2
  } = thresholds;
  
  const failures: string[] = [];
  
  // Check total coverage
  if (result.coverage.coverageRatio < totalCoverage) {
    failures.push(`LOW_TOTAL_COVERAGE (${Math.round(result.coverage.coverageRatio * 100)}% < ${Math.round(totalCoverage * 100)}%)`);
  }
  
  // Check routes coverage
  if (result.bySource.ROUTES.ratio < routesCoverage) {
    failures.push(`LOW_ROUTES_COVERAGE (${Math.round(result.bySource.ROUTES.ratio * 100)}% < ${Math.round(routesCoverage * 100)}%)`);
  }
  
  // Check DEX coverage (only if there's any DEX data expected)
  if (result.bySource.DEX.total > 0 && result.bySource.DEX.ratio < dexCoverage) {
    failures.push(`LOW_DEX_COVERAGE (${Math.round(result.bySource.DEX.ratio * 100)}% < ${Math.round(dexCoverage * 100)}%)`);
  }
  
  // Check actor coverage
  if (result.bySource.ACTOR.total > 0 && result.bySource.ACTOR.ratio < actorCoverage) {
    failures.push(`LOW_ACTOR_COVERAGE (${Math.round(result.bySource.ACTOR.ratio * 100)}% < ${Math.round(actorCoverage * 100)}%)`);
  }
  
  // Check missing critical features
  if (result.missingCritical.length > maxMissingCritical) {
    failures.push(`MISSING_CRITICAL_FEATURES (${result.missingCritical.length} > ${maxMissingCritical})`);
  }
  
  return {
    passed: failures.length === 0,
    failures
  };
}

/**
 * Calculate quality score (0-100)
 */
export function calculateQualityScore(result: CoverageAnalysisResult): number {
  let score = 0;
  
  // Base coverage score (0-50 points)
  score += result.coverage.coverageRatio * 50;
  
  // Source diversity score (0-30 points)
  const sources: FeatureSource[] = ['ROUTES', 'DEX', 'ACTOR', 'WATCHLIST', 'SYSTEM'];
  let sourcesWithData = 0;
  for (const source of sources) {
    if (result.bySource[source].present > 0) {
      sourcesWithData++;
    }
  }
  score += (sourcesWithData / sources.length) * 30;
  
  // Critical features score (0-20 points)
  const criticalFeatures = getCriticalFeatures();
  const criticalPresent = criticalFeatures.length - result.missingCritical.length;
  if (criticalFeatures.length > 0) {
    score += (criticalPresent / criticalFeatures.length) * 20;
  }
  
  return Math.round(score);
}
