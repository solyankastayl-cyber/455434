/**
 * Feature Registry (P0.6)
 * 
 * Catalog of all ML features with descriptions, ranges, and criticality.
 */

import {
  FeatureKey,
  FeatureSource,
  FEATURE_TAXONOMY_VERSION
} from '../types/feature.types.js';

// ============================================
// Feature Definition
// ============================================

export interface FeatureDefinition {
  key: FeatureKey;
  source: FeatureSource;
  description: string;
  
  // Value constraints
  valueType: 'number' | 'boolean';
  range?: { min: number; max: number };
  nullable: boolean;
  
  // Importance
  critical: boolean;          // If null, feature vector is incomplete
  weight: number;             // Relative importance 0..1
  
  // Normalization
  normalization?: {
    method: 'minmax' | 'zscore' | 'log' | 'none';
    params?: Record<string, number>;
  };
  
  // Dependencies
  dependencies?: FeatureKey[];
}

// ============================================
// Feature Registry
// ============================================

export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDefinition> = {
  // ============================================
  // ROUTE FEATURES (P0.5)
  // ============================================
  
  route_exitProbability: {
    key: 'route_exitProbability',
    source: 'ROUTES',
    description: 'Probability that route represents exit to CEX (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: true,
    weight: 0.9,
    normalization: { method: 'none' }
  },
  
  route_pathEntropy: {
    key: 'route_pathEntropy',
    source: 'ROUTES',
    description: 'Path complexity/mixing signal (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.7,
    normalization: { method: 'none' }
  },
  
  route_dumpRiskScore: {
    key: 'route_dumpRiskScore',
    source: 'ROUTES',
    description: 'Composite dump risk score (0-100)',
    valueType: 'number',
    range: { min: 0, max: 100 },
    nullable: true,
    critical: true,
    weight: 0.95,
    normalization: { method: 'minmax', params: { min: 0, max: 100 } }
  },
  
  route_cexTouched: {
    key: 'route_cexTouched',
    source: 'ROUTES',
    description: 'Route touches known CEX address',
    valueType: 'boolean',
    nullable: true,
    critical: true,
    weight: 0.85
  },
  
  route_bridgeTouched: {
    key: 'route_bridgeTouched',
    source: 'ROUTES',
    description: 'Route uses known bridge protocol',
    valueType: 'boolean',
    nullable: true,
    critical: false,
    weight: 0.5
  },
  
  route_mixerSuspected: {
    key: 'route_mixerSuspected',
    source: 'ROUTES',
    description: 'Route shows mixing/obfuscation patterns',
    valueType: 'boolean',
    nullable: true,
    critical: false,
    weight: 0.6
  },
  
  route_swapSegmentsCount: {
    key: 'route_swapSegmentsCount',
    source: 'ROUTES',
    description: 'Number of SWAP segments in route',
    valueType: 'number',
    range: { min: 0, max: 50 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  route_bridgeSegmentsCount: {
    key: 'route_bridgeSegmentsCount',
    source: 'ROUTES',
    description: 'Number of BRIDGE segments in route',
    valueType: 'number',
    range: { min: 0, max: 20 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  route_hopCount: {
    key: 'route_hopCount',
    source: 'ROUTES',
    description: 'Total number of hops in route',
    valueType: 'number',
    range: { min: 0, max: 100 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'log' }
  },
  
  route_chainsCount: {
    key: 'route_chainsCount',
    source: 'ROUTES',
    description: 'Number of unique chains in route',
    valueType: 'number',
    range: { min: 1, max: 10 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'minmax', params: { min: 1, max: 10 } }
  },
  
  route_totalAmountUsd: {
    key: 'route_totalAmountUsd',
    source: 'ROUTES',
    description: 'Total USD value of route',
    valueType: 'number',
    range: { min: 0, max: 100000000 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'log' }
  },
  
  route_durationMs: {
    key: 'route_durationMs',
    source: 'ROUTES',
    description: 'Route duration in milliseconds',
    valueType: 'number',
    range: { min: 0, max: 604800000 }, // 7 days
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'log' }
  },
  
  route_confidence: {
    key: 'route_confidence',
    source: 'ROUTES',
    description: 'Route data quality confidence (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.6,
    normalization: { method: 'none' }
  },
  
  // ============================================
  // DEX FEATURES (P0.4)
  // ============================================
  
  dex_activityScore: {
    key: 'dex_activityScore',
    source: 'DEX',
    description: 'Overall DEX activity score (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.6,
    normalization: { method: 'none' }
  },
  
  dex_swapBeforeExit: {
    key: 'dex_swapBeforeExit',
    source: 'DEX',
    description: 'Swap detected before CEX exit',
    valueType: 'boolean',
    nullable: true,
    critical: true,
    weight: 0.8
  },
  
  dex_swapCount24h: {
    key: 'dex_swapCount24h',
    source: 'DEX',
    description: 'Number of swaps in last 24h',
    valueType: 'number',
    range: { min: 0, max: 1000 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'log' }
  },
  
  dex_swapCountTotal: {
    key: 'dex_swapCountTotal',
    source: 'DEX',
    description: 'Total swap count in window',
    valueType: 'number',
    range: { min: 0, max: 10000 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  dex_uniquePools: {
    key: 'dex_uniquePools',
    source: 'DEX',
    description: 'Number of unique pools used',
    valueType: 'number',
    range: { min: 0, max: 100 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'log' }
  },
  
  dex_uniqueTokensTraded: {
    key: 'dex_uniqueTokensTraded',
    source: 'DEX',
    description: 'Number of unique tokens traded',
    valueType: 'number',
    range: { min: 0, max: 200 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  dex_chainsUsed: {
    key: 'dex_chainsUsed',
    source: 'DEX',
    description: 'Number of chains with DEX activity',
    valueType: 'number',
    range: { min: 0, max: 10 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'minmax', params: { min: 0, max: 10 } }
  },
  
  dex_avgSwapSizeUsd: {
    key: 'dex_avgSwapSizeUsd',
    source: 'DEX',
    description: 'Average swap size in USD',
    valueType: 'number',
    range: { min: 0, max: 10000000 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  dex_swapFrequencyPerHour: {
    key: 'dex_swapFrequencyPerHour',
    source: 'DEX',
    description: 'Swaps per hour over observation window',
    valueType: 'number',
    range: { min: 0, max: 100 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'log' }
  },
  
  dex_hasRecentSwap: {
    key: 'dex_hasRecentSwap',
    source: 'DEX',
    description: 'Has swap activity in last 24h',
    valueType: 'boolean',
    nullable: true,
    critical: false,
    weight: 0.5
  },
  
  dex_swapBeforeExitScore: {
    key: 'dex_swapBeforeExitScore',
    source: 'DEX',
    description: 'Swap-before-exit pattern score (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.7,
    normalization: { method: 'none' }
  },
  
  // ============================================
  // MARKET FEATURES (P1.5 - STUB)
  // ============================================
  
  market_volumeDeltaZscore: {
    key: 'market_volumeDeltaZscore',
    source: 'MARKET',
    description: 'Volume change z-score vs baseline',
    valueType: 'number',
    range: { min: -10, max: 10 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'minmax', params: { min: -10, max: 10 } }
  },
  
  market_volatilityRegime: {
    key: 'market_volatilityRegime',
    source: 'MARKET',
    description: 'Current volatility regime (0=low, 1=high)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'none' }
  },
  
  market_liquidityRegime: {
    key: 'market_liquidityRegime',
    source: 'MARKET',
    description: 'Current liquidity regime (0=low, 1=high)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'none' }
  },
  
  market_priceChangePercent24h: {
    key: 'market_priceChangePercent24h',
    source: 'MARKET',
    description: '24h price change percentage',
    valueType: 'number',
    range: { min: -100, max: 1000 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'minmax', params: { min: -50, max: 50 } }
  },
  
  market_volumeUsd24h: {
    key: 'market_volumeUsd24h',
    source: 'MARKET',
    description: '24h trading volume in USD',
    valueType: 'number',
    range: { min: 0, max: 100000000000 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  market_dataQuality: {
    key: 'market_dataQuality',
    source: 'MARKET',
    description: 'Market data quality score (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'none' }
  },
  
  market_isStressed: {
    key: 'market_isStressed',
    source: 'MARKET',
    description: 'Market is in STRESSED regime',
    valueType: 'boolean',
    nullable: true,
    critical: false,
    weight: 0.5
  },
  
  // ============================================
  // ACTOR FEATURES
  // ============================================
  
  actor_confidence: {
    key: 'actor_confidence',
    source: 'ACTOR',
    description: 'Actor identification confidence (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.6,
    normalization: { method: 'none' }
  },
  
  actor_patternCount: {
    key: 'actor_patternCount',
    source: 'ACTOR',
    description: 'Number of known patterns for actor',
    valueType: 'number',
    range: { min: 0, max: 50 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'log' }
  },
  
  actor_repeatBridgeScore: {
    key: 'actor_repeatBridgeScore',
    source: 'ACTOR',
    description: 'Repeat bridge usage pattern score (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'none' }
  },
  
  actor_routeDominance: {
    key: 'actor_routeDominance',
    source: 'ACTOR',
    description: 'How dominant is primary route pattern (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'none' }
  },
  
  actor_clusterSize: {
    key: 'actor_clusterSize',
    source: 'ACTOR',
    description: 'Number of wallets in actor cluster',
    valueType: 'number',
    range: { min: 1, max: 1000 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'log' }
  },
  
  actor_riskTier: {
    key: 'actor_riskTier',
    source: 'ACTOR',
    description: 'Actor risk tier (0-3)',
    valueType: 'number',
    range: { min: 0, max: 3 },
    nullable: true,
    critical: false,
    weight: 0.6,
    normalization: { method: 'minmax', params: { min: 0, max: 3 } }
  },
  
  // ============================================
  // WATCHLIST FEATURES
  // ============================================
  
  watchlist_isTracked: {
    key: 'watchlist_isTracked',
    source: 'WATCHLIST',
    description: 'Entity is on watchlist',
    valueType: 'boolean',
    nullable: false,
    critical: false,
    weight: 0.3
  },
  
  watchlist_alertCount: {
    key: 'watchlist_alertCount',
    source: 'WATCHLIST',
    description: 'Number of alerts for entity',
    valueType: 'number',
    range: { min: 0, max: 100 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'log' }
  },
  
  watchlist_lastAlertSeverity: {
    key: 'watchlist_lastAlertSeverity',
    source: 'WATCHLIST',
    description: 'Last alert severity (0-3)',
    valueType: 'number',
    range: { min: 0, max: 3 },
    nullable: true,
    critical: false,
    weight: 0.5,
    normalization: { method: 'minmax', params: { min: 0, max: 3 } }
  },
  
  watchlist_trackingSince: {
    key: 'watchlist_trackingSince',
    source: 'WATCHLIST',
    description: 'Days since added to watchlist',
    valueType: 'number',
    range: { min: 0, max: 365 },
    nullable: true,
    critical: false,
    weight: 0.2,
    normalization: { method: 'log' }
  },
  
  // ============================================
  // SYSTEM FEATURES (P0.1)
  // ============================================
  
  system_dataFreshnessLagMs: {
    key: 'system_dataFreshnessLagMs',
    source: 'SYSTEM',
    description: 'Data freshness lag in milliseconds',
    valueType: 'number',
    range: { min: 0, max: 86400000 }, // 24h
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'log' }
  },
  
  system_chainCoverage: {
    key: 'system_chainCoverage',
    source: 'SYSTEM',
    description: 'Chain data coverage (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.4,
    normalization: { method: 'none' }
  },
  
  system_errorRate: {
    key: 'system_errorRate',
    source: 'SYSTEM',
    description: 'Recent ingestion error rate (0-1)',
    valueType: 'number',
    range: { min: 0, max: 1 },
    nullable: true,
    critical: false,
    weight: 0.3,
    normalization: { method: 'none' }
  },
  
  system_eventsInWindow: {
    key: 'system_eventsInWindow',
    source: 'SYSTEM',
    description: 'Number of events in observation window',
    valueType: 'number',
    range: { min: 0, max: 100000 },
    nullable: true,
    critical: false,
    weight: 0.2,
    normalization: { method: 'log' }
  },
  
  system_ingestionHealthy: {
    key: 'system_ingestionHealthy',
    source: 'SYSTEM',
    description: 'Ingestion system is healthy',
    valueType: 'boolean',
    nullable: false,
    critical: false,
    weight: 0.5
  }
};

// ============================================
// Registry Helpers
// ============================================

/**
 * Get all feature keys
 */
export function getAllFeatureKeys(): FeatureKey[] {
  return Object.keys(FEATURE_REGISTRY) as FeatureKey[];
}

/**
 * Get features by source
 */
export function getFeaturesBySource(source: FeatureSource): FeatureDefinition[] {
  return Object.values(FEATURE_REGISTRY).filter(f => f.source === source);
}

/**
 * Get critical features
 */
export function getCriticalFeatures(): FeatureDefinition[] {
  return Object.values(FEATURE_REGISTRY).filter(f => f.critical);
}

/**
 * Get feature definition
 */
export function getFeatureDefinition(key: FeatureKey): FeatureDefinition | undefined {
  return FEATURE_REGISTRY[key];
}

/**
 * Validate feature value
 */
export function validateFeatureValue(key: FeatureKey, value: any): boolean {
  const def = FEATURE_REGISTRY[key];
  if (!def) return false;
  
  // Allow null if nullable
  if (value === null) return def.nullable;
  
  // Type check
  if (def.valueType === 'boolean') {
    return typeof value === 'boolean';
  }
  
  if (def.valueType === 'number') {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
      return false;
    }
    
    // Range check
    if (def.range) {
      return value >= def.range.min && value <= def.range.max;
    }
  }
  
  return true;
}

/**
 * Get registry version
 */
export function getRegistryVersion(): string {
  return FEATURE_TAXONOMY_VERSION;
}

/**
 * Get registry stats
 */
export function getRegistryStats(): {
  version: string;
  totalFeatures: number;
  criticalFeatures: number;
  bySource: Record<FeatureSource, number>;
} {
  const bySource: Record<FeatureSource, number> = {
    ROUTES: 0,
    DEX: 0,
    MARKET: 0,
    ACTOR: 0,
    WATCHLIST: 0,
    SYSTEM: 0
  };
  
  let criticalCount = 0;
  
  for (const def of Object.values(FEATURE_REGISTRY)) {
    bySource[def.source]++;
    if (def.critical) criticalCount++;
  }
  
  return {
    version: FEATURE_TAXONOMY_VERSION,
    totalFeatures: Object.keys(FEATURE_REGISTRY).length,
    criticalFeatures: criticalCount,
    bySource
  };
}
