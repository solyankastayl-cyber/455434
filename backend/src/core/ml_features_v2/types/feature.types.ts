/**
 * ML Feature Types (P0.6)
 * 
 * Unified feature schema for ML Feature Taxonomy v2.
 */

// ============================================
// Feature Taxonomy Version
// ============================================

export const FEATURE_TAXONOMY_VERSION = 'v2';

// ============================================
// Feature Sources
// ============================================

export type FeatureSource = 
  | 'ROUTES'      // P0.3/P0.5 - Route Intelligence
  | 'DEX'         // P0.4 - DEX Layer
  | 'MARKET'      // P1.5 - CEX/Volumes (future)
  | 'ACTOR'       // Actor clustering
  | 'WATCHLIST'   // Watchlist tracking
  | 'SYSTEM';     // P0.1 - Ingestion health

// ============================================
// Feature Keys (Enumerated)
// ============================================

export type RouteFeatureKey =
  | 'route_exitProbability'
  | 'route_pathEntropy'
  | 'route_dumpRiskScore'
  | 'route_cexTouched'
  | 'route_bridgeTouched'
  | 'route_mixerSuspected'
  | 'route_swapSegmentsCount'
  | 'route_bridgeSegmentsCount'
  | 'route_hopCount'
  | 'route_chainsCount'
  | 'route_totalAmountUsd'
  | 'route_durationMs'
  | 'route_confidence';

export type DexFeatureKey =
  | 'dex_activityScore'
  | 'dex_swapBeforeExit'
  | 'dex_swapCount24h'
  | 'dex_swapCountTotal'
  | 'dex_uniquePools'
  | 'dex_uniqueTokensTraded'
  | 'dex_chainsUsed'
  | 'dex_avgSwapSizeUsd'
  | 'dex_swapFrequencyPerHour'
  | 'dex_hasRecentSwap'
  | 'dex_swapBeforeExitScore';

export type MarketFeatureKey =
  | 'market_volumeDeltaZscore'
  | 'market_volatilityRegime'
  | 'market_liquidityRegime'
  | 'market_priceChangePercent24h'
  | 'market_volumeUsd24h'
  | 'market_dataQuality'
  | 'market_isStressed';

export type ActorFeatureKey =
  | 'actor_confidence'
  | 'actor_patternCount'
  | 'actor_repeatBridgeScore'
  | 'actor_routeDominance'
  | 'actor_clusterSize'
  | 'actor_riskTier';

export type WatchlistFeatureKey =
  | 'watchlist_isTracked'
  | 'watchlist_alertCount'
  | 'watchlist_lastAlertSeverity'
  | 'watchlist_trackingSince';

export type SystemFeatureKey =
  | 'system_dataFreshnessLagMs'
  | 'system_chainCoverage'
  | 'system_errorRate'
  | 'system_eventsInWindow'
  | 'system_ingestionHealthy';

export type FeatureKey =
  | RouteFeatureKey
  | DexFeatureKey
  | MarketFeatureKey
  | ActorFeatureKey
  | WatchlistFeatureKey
  | SystemFeatureKey;

// ============================================
// Feature Value Types
// ============================================

export type FeatureValue = number | boolean | null;

export interface FeatureEntry {
  key: FeatureKey;
  value: FeatureValue;
  source: FeatureSource;
  timestamp: Date;
  confidence?: number;  // 0..1, how confident we are in this value
  isNull: boolean;
}

// ============================================
// Feature Vector
// ============================================

export interface FeatureVector {
  // Entity info
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  
  // Time window
  windowStart: Date;
  windowEnd: Date;
  
  // Taxonomy version
  taxonomyVersion: string;
  
  // Features by source
  routes: Partial<Record<RouteFeatureKey, FeatureValue>>;
  dex: Partial<Record<DexFeatureKey, FeatureValue>>;
  market: Partial<Record<MarketFeatureKey, FeatureValue>>;
  actor: Partial<Record<ActorFeatureKey, FeatureValue>>;
  watchlist: Partial<Record<WatchlistFeatureKey, FeatureValue>>;
  system: Partial<Record<SystemFeatureKey, FeatureValue>>;
  
  // Metadata
  coverage: FeatureCoverage;
  buildTimestamp: Date;
  buildDurationMs: number;
}

// ============================================
// Coverage & Quality
// ============================================

export interface FeatureCoverage {
  totalFeatures: number;
  presentFeatures: number;
  nullFeatures: number;
  coveragePercent: number;
  
  bySource: Record<FeatureSource, {
    total: number;
    present: number;
    null: number;
  }>;
  
  missingCritical: string[];  // Critical features that are null
}

// ============================================
// Provider Types
// ============================================

export interface ProviderContext {
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR';
  entityId: string;
  windowStart: Date;
  windowEnd: Date;
  chain?: string;
  skipExternal?: boolean;  // Skip external API calls
}

export interface ProviderResult<T extends Record<string, FeatureValue>> {
  features: T;
  source: FeatureSource;
  timestamp: Date;
  errors: string[];
  durationMs: number;
}

// ============================================
// Build Options
// ============================================

export interface FeatureBuildOptions {
  skipMarket?: boolean;      // Skip market features (CEX not ready)
  skipActor?: boolean;       // Skip actor features
  skipWatchlist?: boolean;   // Skip watchlist features
  normalize?: boolean;       // Apply normalization
  persist?: boolean;         // Save to feature_snapshots
  auditLog?: boolean;        // Create audit entry
}

// ============================================
// Type Guards
// ============================================

export function isRouteFeature(key: string): key is RouteFeatureKey {
  return key.startsWith('route_');
}

export function isDexFeature(key: string): key is DexFeatureKey {
  return key.startsWith('dex_');
}

export function isMarketFeature(key: string): key is MarketFeatureKey {
  return key.startsWith('market_');
}

export function isActorFeature(key: string): key is ActorFeatureKey {
  return key.startsWith('actor_');
}

export function isWatchlistFeature(key: string): key is WatchlistFeatureKey {
  return key.startsWith('watchlist_');
}

export function isSystemFeature(key: string): key is SystemFeatureKey {
  return key.startsWith('system_');
}

export function getFeatureSource(key: FeatureKey): FeatureSource {
  if (isRouteFeature(key)) return 'ROUTES';
  if (isDexFeature(key)) return 'DEX';
  if (isMarketFeature(key)) return 'MARKET';
  if (isActorFeature(key)) return 'ACTOR';
  if (isWatchlistFeature(key)) return 'WATCHLIST';
  if (isSystemFeature(key)) return 'SYSTEM';
  return 'SYSTEM';
}
