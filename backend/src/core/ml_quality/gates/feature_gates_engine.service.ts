/**
 * Feature Gates Engine (P0.7)
 * 
 * Deterministic rules for allowing/blocking ML usage.
 * NEVER uses ML - only threshold-based rules.
 */

import { FeatureVector } from '../../ml_features_v2/types/feature.types.js';
import { 
  IGateDecision, 
  BlockReason,
  saveCoverageSnapshot 
} from '../storage/feature_coverage.model.js';
import { 
  analyzeCoverage, 
  checkCoverageThresholds,
  calculateQualityScore 
} from '../analyzers/feature_coverage_analyzer.service.js';
import { 
  analyzeFreshness, 
  checkFreshnessThresholds 
} from '../analyzers/feature_freshness_analyzer.service.js';

// ============================================
// Types
// ============================================

export interface GateConfig {
  // Coverage thresholds
  minTotalCoverage: number;      // 0-1, default 0.75
  minRoutesCoverage: number;     // 0-1, default 0.70
  minDexCoverage: number;        // 0-1, default 0.50
  minActorCoverage: number;      // 0-1, default 0.30
  maxMissingCritical: number;    // default 2
  
  // Freshness thresholds (ms)
  maxOverallLagMs: number;       // default 6h
  maxRoutesLagMs: number;        // default 6h
  maxDexLagMs: number;           // default 1h
  maxMarketLagMs: number;        // default 15m
  
  // Quality thresholds
  minQualityScore: number;       // 0-100, default 50
  
  // Feature flags
  strictMode: boolean;           // If true, any failure blocks
  marketRequired: boolean;       // If true, market data required
}

export interface GateCheckResult {
  decision: IGateDecision;
  coverageResult: ReturnType<typeof analyzeCoverage>;
  freshnessResult: Awaited<ReturnType<typeof analyzeFreshness>>;
  details: {
    coverageFailures: string[];
    freshnessFailures: string[];
    qualityScore: number;
  };
}

// ============================================
// Default Config
// ============================================

export const DEFAULT_GATE_CONFIG: GateConfig = {
  // Coverage
  minTotalCoverage: 0.75,
  minRoutesCoverage: 0.70,
  minDexCoverage: 0.50,
  minActorCoverage: 0.30,
  maxMissingCritical: 2,
  
  // Freshness
  maxOverallLagMs: 6 * 60 * 60 * 1000,   // 6 hours
  maxRoutesLagMs: 6 * 60 * 60 * 1000,    // 6 hours
  maxDexLagMs: 1 * 60 * 60 * 1000,       // 1 hour
  maxMarketLagMs: 15 * 60 * 1000,        // 15 minutes
  
  // Quality
  minQualityScore: 50,
  
  // Flags
  strictMode: false,
  marketRequired: false  // Market not implemented yet
};

// ============================================
// Gates Engine
// ============================================

/**
 * Check all gates for a feature vector
 */
export async function checkGates(
  vector: FeatureVector,
  config: Partial<GateConfig> = {}
): Promise<GateCheckResult> {
  const cfg = { ...DEFAULT_GATE_CONFIG, ...config };
  const blockedBy: BlockReason[] = [];
  
  // Analyze coverage
  const coverageResult = analyzeCoverage(vector);
  const coverageCheck = checkCoverageThresholds(coverageResult, {
    totalCoverage: cfg.minTotalCoverage,
    routesCoverage: cfg.minRoutesCoverage,
    dexCoverage: cfg.minDexCoverage,
    actorCoverage: cfg.minActorCoverage,
    maxMissingCritical: cfg.maxMissingCritical
  });
  
  // Map coverage failures to block reasons
  for (const failure of coverageCheck.failures) {
    if (failure.includes('LOW_TOTAL_COVERAGE')) blockedBy.push('LOW_TOTAL_COVERAGE');
    else if (failure.includes('LOW_ROUTES_COVERAGE')) blockedBy.push('LOW_ROUTES_COVERAGE');
    else if (failure.includes('LOW_DEX_COVERAGE')) blockedBy.push('LOW_DEX_COVERAGE');
    else if (failure.includes('LOW_ACTOR_COVERAGE')) blockedBy.push('LOW_ACTOR_COVERAGE');
    else if (failure.includes('MISSING_CRITICAL')) blockedBy.push('MISSING_CRITICAL_FEATURES');
  }
  
  // Analyze freshness
  const freshnessResult = await analyzeFreshness(vector.entityId, vector.entityType);
  const freshnessCheck = checkFreshnessThresholds(freshnessResult.freshness, {
    ROUTES: cfg.maxRoutesLagMs,
    DEX: cfg.maxDexLagMs,
    MARKET: cfg.maxMarketLagMs
  });
  
  // Map freshness failures to block reasons
  for (const failure of freshnessCheck.failures) {
    if (failure.includes('STALE_DATA')) blockedBy.push('STALE_DATA');
    else if (failure.includes('STALE_ROUTES')) blockedBy.push('STALE_ROUTES_DATA');
    else if (failure.includes('STALE_DEX')) blockedBy.push('STALE_DEX_DATA');
    else if (failure.includes('STALE_MARKET')) blockedBy.push('STALE_MARKET_DATA');
  }
  
  // Calculate quality score
  const qualityScore = calculateQualityScore(coverageResult);
  
  // Check quality score threshold
  if (qualityScore < cfg.minQualityScore) {
    // Don't add as block reason, just affects decision
  }
  
  // Check market requirement
  if (cfg.marketRequired && coverageResult.bySource.MARKET.present === 0) {
    // Market data not available yet - soft gate
    // blockedBy.push('STALE_MARKET_DATA');
  }
  
  // Determine final decision
  const allowed = blockedBy.length === 0 && qualityScore >= cfg.minQualityScore;
  
  const decision: IGateDecision = {
    allowed,
    blockedBy,
    score: qualityScore,
    timestamp: new Date()
  };
  
  return {
    decision,
    coverageResult,
    freshnessResult,
    details: {
      coverageFailures: coverageCheck.failures,
      freshnessFailures: freshnessCheck.failures,
      qualityScore
    }
  };
}

/**
 * Check gates and persist snapshot
 */
export async function checkGatesAndPersist(
  vector: FeatureVector,
  featureSnapshotId?: string,
  config: Partial<GateConfig> = {}
): Promise<GateCheckResult> {
  const result = await checkGates(vector, config);
  
  // Save coverage snapshot
  await saveCoverageSnapshot({
    entityType: vector.entityType,
    entityId: vector.entityId,
    windowStart: vector.windowStart,
    windowEnd: vector.windowEnd,
    timestamp: new Date(),
    coverage: result.coverageResult.coverage,
    bySource: result.coverageResult.bySource,
    freshness: result.freshnessResult.freshness,
    missingCritical: result.coverageResult.missingCritical,
    decision: result.decision,
    featureSnapshotId,
    version: 'v1'
  });
  
  return result;
}

/**
 * Quick check - just returns allowed/blocked
 */
export async function isAllowed(
  vector: FeatureVector,
  config: Partial<GateConfig> = {}
): Promise<boolean> {
  const result = await checkGates(vector, config);
  return result.decision.allowed;
}

/**
 * Get human-readable explanation of gate decision
 */
export function explainDecision(result: GateCheckResult): string {
  if (result.decision.allowed) {
    return `ALLOWED: Quality score ${result.decision.score}/100, coverage ${Math.round(result.coverageResult.coverage.coverageRatio * 100)}%`;
  }
  
  const reasons = result.decision.blockedBy.map(r => {
    switch (r) {
      case 'LOW_TOTAL_COVERAGE':
        return `Total coverage ${Math.round(result.coverageResult.coverage.coverageRatio * 100)}% below threshold`;
      case 'LOW_ROUTES_COVERAGE':
        return `Routes coverage ${Math.round(result.coverageResult.bySource.ROUTES.ratio * 100)}% below threshold`;
      case 'LOW_DEX_COVERAGE':
        return `DEX coverage ${Math.round(result.coverageResult.bySource.DEX.ratio * 100)}% below threshold`;
      case 'STALE_DATA':
        return `Data lag exceeds maximum allowed`;
      case 'MISSING_CRITICAL_FEATURES':
        return `Missing critical features: ${result.coverageResult.missingCritical.join(', ')}`;
      default:
        return r;
    }
  });
  
  return `BLOCKED: ${reasons.join('; ')}`;
}
