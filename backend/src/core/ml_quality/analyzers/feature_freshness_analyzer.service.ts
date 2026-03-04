/**
 * Feature Freshness Analyzer (P0.7)
 * 
 * Calculates data staleness across sources and chains.
 * Deterministic rules only - no ML.
 */

import { FeatureSource } from '../../ml_features_v2/types/feature.types.js';
import { IFreshnessStats } from '../storage/feature_coverage.model.js';
import { ChainSyncStateModel } from '../../ingestion_control/chain_sync_state.model.js';
import { RouteEnrichedModel } from '../../route_intelligence_v2_1/storage/route_enriched.model.js';
import { DexTradeModel } from '../../dex_layer/storage/dex_trade.model.js';
import { ActorProfileModel } from '../../actor_intelligence/actor_profile.model.js';

// ============================================
// Types
// ============================================

export interface FreshnessAnalysisResult {
  freshness: IFreshnessStats;
  details: {
    chainLags: Record<string, number>;
    sourceLastUpdated: Record<string, Date | null>;
  };
}

// Default max lag thresholds per source (in milliseconds)
const DEFAULT_LAG_THRESHOLDS: Record<FeatureSource, number> = {
  ROUTES: 6 * 60 * 60 * 1000,     // 6 hours
  DEX: 1 * 60 * 60 * 1000,        // 1 hour
  ACTOR: 24 * 60 * 60 * 1000,     // 24 hours
  WATCHLIST: 24 * 60 * 60 * 1000, // 24 hours
  SYSTEM: 10 * 60 * 1000,         // 10 minutes
  MARKET: 15 * 60 * 1000          // 15 minutes (when available)
};

// ============================================
// Freshness Analyzer
// ============================================

/**
 * Analyze data freshness for an entity
 */
export async function analyzeFreshness(
  entityId: string,
  entityType: 'WALLET' | 'TOKEN' | 'ACTOR'
): Promise<FreshnessAnalysisResult> {
  const now = Date.now();
  const chainLags: Record<string, number> = {};
  const sourceLastUpdated: Record<string, Date | null> = {};
  const perSourceLag: Record<string, number> = {};
  
  // Get chain sync states
  const chainStates = await ChainSyncStateModel.find({}).lean();
  
  let maxChainLag = 0;
  for (const state of chainStates) {
    if (state.lastSyncedAt) {
      const lag = now - new Date(state.lastSyncedAt).getTime();
      chainLags[state.chain] = lag;
      if (lag > maxChainLag) {
        maxChainLag = lag;
      }
    }
  }
  
  // Get source-specific freshness
  const [routesFreshness, dexFreshness, actorFreshness] = await Promise.all([
    getRoutesFreshness(entityId),
    getDexFreshness(entityId),
    getActorFreshness(entityId)
  ]);
  
  // Routes - cap Infinity at large number for storage
  sourceLastUpdated['ROUTES'] = routesFreshness.lastUpdated;
  perSourceLag['ROUTES'] = routesFreshness.lagMs === Infinity ? -1 : routesFreshness.lagMs;
  
  // DEX
  sourceLastUpdated['DEX'] = dexFreshness.lastUpdated;
  perSourceLag['DEX'] = dexFreshness.lagMs === Infinity ? -1 : dexFreshness.lagMs;
  
  // Actor
  sourceLastUpdated['ACTOR'] = actorFreshness.lastUpdated;
  perSourceLag['ACTOR'] = actorFreshness.lagMs === Infinity ? -1 : actorFreshness.lagMs;
  
  // System - use max chain lag
  perSourceLag['SYSTEM'] = maxChainLag;
  const validSyncDates = chainStates
    .filter(s => s.lastSyncedAt && !isNaN(new Date(s.lastSyncedAt).getTime()))
    .map(s => new Date(s.lastSyncedAt!).getTime());
  sourceLastUpdated['SYSTEM'] = validSyncDates.length > 0 
    ? new Date(Math.max(...validSyncDates))
    : null;
  
  // Watchlist - check system alerts
  perSourceLag['WATCHLIST'] = 0; // Always fresh (it's user-driven)
  sourceLastUpdated['WATCHLIST'] = new Date();
  
  // Market - stub, always stale (-1 represents no data)
  perSourceLag['MARKET'] = -1;
  sourceLastUpdated['MARKET'] = null;
  
  // Calculate max and avg lag (exclude -1 which means no data)
  const validLags = Object.values(perSourceLag).filter(l => l > 0);
  const maxLagMs = validLags.length > 0 ? Math.max(...validLags) : 0;
  const avgLagMs = validLags.length > 0 
    ? Math.round(validLags.reduce((a, b) => a + b, 0) / validLags.length)
    : 0;
  
  // Find oldest/newest timestamps
  const validDates = Object.values(sourceLastUpdated)
    .filter(d => d !== null && !isNaN(d.getTime())) as Date[];
  const oldestDataTimestamp = validDates.length > 0 
    ? new Date(Math.min(...validDates.map(d => d.getTime())))
    : undefined;
  const newestDataTimestamp = validDates.length > 0 
    ? new Date(Math.max(...validDates.map(d => d.getTime())))
    : undefined;
  
  return {
    freshness: {
      maxLagMs,
      avgLagMs,
      perSourceLag,
      oldestDataTimestamp,
      newestDataTimestamp
    },
    details: {
      chainLags,
      sourceLastUpdated
    }
  };
}

/**
 * Check if freshness meets thresholds
 */
export function checkFreshnessThresholds(
  freshness: IFreshnessStats,
  thresholds: Partial<Record<FeatureSource, number>> = {}
): {
  passed: boolean;
  failures: string[];
} {
  const mergedThresholds = { ...DEFAULT_LAG_THRESHOLDS, ...thresholds };
  const failures: string[] = [];
  
  // Check overall max lag (6 hours default)
  const maxAllowedLag = 6 * 60 * 60 * 1000;
  if (freshness.maxLagMs > maxAllowedLag) {
    failures.push(`STALE_DATA (max lag ${formatLag(freshness.maxLagMs)} > ${formatLag(maxAllowedLag)})`);
  }
  
  // Check per-source lags (ignore -1 which means no data available)
  for (const [source, lag] of Object.entries(freshness.perSourceLag)) {
    const threshold = mergedThresholds[source as FeatureSource];
    if (threshold && lag > 0 && lag > threshold) {
      failures.push(`STALE_${source}_DATA (${formatLag(lag)} > ${formatLag(threshold)})`);
    }
  }
  
  return {
    passed: failures.length === 0,
    failures
  };
}

// ============================================
// Helper Functions
// ============================================

async function getRoutesFreshness(entityId: string): Promise<{ lastUpdated: Date | null; lagMs: number }> {
  const latestRoute = await RouteEnrichedModel.findOne({
    wallet: entityId.toLowerCase()
  })
  .sort({ updatedAt: -1 })
  .select('updatedAt')
  .lean();
  
  if (!latestRoute?.updatedAt) {
    return { lastUpdated: null, lagMs: Infinity };
  }
  
  const lagMs = Date.now() - new Date(latestRoute.updatedAt).getTime();
  return { lastUpdated: new Date(latestRoute.updatedAt), lagMs };
}

async function getDexFreshness(entityId: string): Promise<{ lastUpdated: Date | null; lagMs: number }> {
  const latestTrade = await DexTradeModel.findOne({
    trader: entityId.toLowerCase()
  })
  .sort({ timestamp: -1 })
  .select('timestamp')
  .lean();
  
  if (!latestTrade?.timestamp) {
    return { lastUpdated: null, lagMs: Infinity };
  }
  
  const timestamp = new Date(latestTrade.timestamp * 1000);
  const lagMs = Date.now() - timestamp.getTime();
  return { lastUpdated: timestamp, lagMs };
}

async function getActorFreshness(entityId: string): Promise<{ lastUpdated: Date | null; lagMs: number }> {
  const actor = await ActorProfileModel.findOne({
    $or: [
      { actorId: entityId },
      { primaryAddress: entityId.toLowerCase() }
    ]
  })
  .select('lastUpdatedAt')
  .lean();
  
  if (!actor?.lastUpdatedAt) {
    return { lastUpdated: null, lagMs: Infinity };
  }
  
  const lagMs = Date.now() - new Date(actor.lastUpdatedAt).getTime();
  return { lastUpdated: new Date(actor.lastUpdatedAt), lagMs };
}

function formatLag(ms: number): string {
  if (ms === Infinity) return 'N/A';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}
