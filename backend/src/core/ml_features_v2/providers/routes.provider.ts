/**
 * Routes Feature Provider (P0.6)
 * 
 * Extracts ML features from Route Intelligence v2.1 (P0.5).
 */

import {
  ProviderContext,
  ProviderResult,
  RouteFeatureKey,
  FeatureValue
} from '../types/feature.types.js';
import { RouteEnrichedModel, IRouteEnriched } from '../../route_intelligence_v2_1/storage/route_enriched.model.js';

// ============================================
// Types
// ============================================

export type RouteFeatures = Partial<Record<RouteFeatureKey, FeatureValue>>;

// ============================================
// Routes Provider
// ============================================

export async function extractRouteFeatures(
  ctx: ProviderContext
): Promise<ProviderResult<RouteFeatures>> {
  const startTime = Date.now();
  const errors: string[] = [];
  const features: RouteFeatures = {};
  
  try {
    // Query routes for this entity in time window
    const routes = await RouteEnrichedModel.find({
      wallet: ctx.entityId.toLowerCase(),
      createdAt: {
        $gte: ctx.windowStart,
        $lte: ctx.windowEnd
      }
    })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
    
    if (routes.length === 0) {
      // No routes found - return null features
      return {
        features: createNullRouteFeatures(),
        source: 'ROUTES',
        timestamp: new Date(),
        errors: [],
        durationMs: Date.now() - startTime
      };
    }
    
    // Aggregate features from routes
    const aggregated = aggregateRouteFeatures(routes);
    
    // Map to feature keys
    features.route_exitProbability = aggregated.maxExitProbability;
    features.route_pathEntropy = aggregated.avgPathEntropy;
    features.route_dumpRiskScore = aggregated.maxDumpRiskScore;
    features.route_cexTouched = aggregated.anyCexTouched;
    features.route_bridgeTouched = aggregated.anyBridgeTouched;
    features.route_mixerSuspected = aggregated.anyMixerSuspected;
    features.route_swapSegmentsCount = aggregated.totalSwapSegments;
    features.route_bridgeSegmentsCount = aggregated.totalBridgeSegments;
    features.route_hopCount = aggregated.totalHops;
    features.route_chainsCount = aggregated.uniqueChains;
    features.route_totalAmountUsd = aggregated.totalAmountUsd;
    features.route_durationMs = aggregated.avgDurationMs;
    features.route_confidence = aggregated.avgConfidence;
    
  } catch (err) {
    errors.push(`Routes provider error: ${(err as Error).message}`);
    return {
      features: createNullRouteFeatures(),
      source: 'ROUTES',
      timestamp: new Date(),
      errors,
      durationMs: Date.now() - startTime
    };
  }
  
  return {
    features,
    source: 'ROUTES',
    timestamp: new Date(),
    errors,
    durationMs: Date.now() - startTime
  };
}

// ============================================
// Aggregation
// ============================================

interface RouteAggregation {
  maxExitProbability: number;
  avgPathEntropy: number;
  maxDumpRiskScore: number;
  anyCexTouched: boolean;
  anyBridgeTouched: boolean;
  anyMixerSuspected: boolean;
  totalSwapSegments: number;
  totalBridgeSegments: number;
  totalHops: number;
  uniqueChains: number;
  totalAmountUsd: number;
  avgDurationMs: number;
  avgConfidence: number;
}

function aggregateRouteFeatures(routes: IRouteEnriched[]): RouteAggregation {
  let maxExitProbability = 0;
  let sumPathEntropy = 0;
  let maxDumpRiskScore = 0;
  let anyCexTouched = false;
  let anyBridgeTouched = false;
  let anyMixerSuspected = false;
  let totalSwapSegments = 0;
  let totalBridgeSegments = 0;
  let totalHops = 0;
  const allChains = new Set<string>();
  let totalAmountUsd = 0;
  let sumDurationMs = 0;
  let sumConfidence = 0;
  
  for (const route of routes) {
    // Risk scores - take max
    if (route.risk?.exitProbability > maxExitProbability) {
      maxExitProbability = route.risk.exitProbability;
    }
    if (route.risk?.dumpRiskScore > maxDumpRiskScore) {
      maxDumpRiskScore = route.risk.dumpRiskScore;
    }
    
    // Path entropy - average
    sumPathEntropy += route.risk?.pathEntropy || 0;
    
    // Labels - any true
    if (route.labels?.cexTouched) anyCexTouched = true;
    if (route.labels?.bridgeTouched) anyBridgeTouched = true;
    if (route.labels?.mixerSuspected) anyMixerSuspected = true;
    
    // Segment counts - sum
    totalSwapSegments += route.swapsCount || 0;
    totalBridgeSegments += route.bridgesCount || 0;
    totalHops += route.segmentsCount || 0;
    
    // Chains - unique set
    if (route.chains) {
      route.chains.forEach(c => allChains.add(c));
    }
    
    // Amount - sum
    totalAmountUsd += route.totalAmountUsd || 0;
    
    // Duration - calculate from window
    if (route.timeWindowStart && route.timeWindowEnd) {
      const start = new Date(route.timeWindowStart).getTime();
      const end = new Date(route.timeWindowEnd).getTime();
      sumDurationMs += (end - start);
    }
    
    // Confidence - average
    sumConfidence += route.confidence || 0;
  }
  
  const count = routes.length;
  
  return {
    maxExitProbability,
    avgPathEntropy: count > 0 ? sumPathEntropy / count : 0,
    maxDumpRiskScore,
    anyCexTouched,
    anyBridgeTouched,
    anyMixerSuspected,
    totalSwapSegments,
    totalBridgeSegments,
    totalHops,
    uniqueChains: allChains.size,
    totalAmountUsd,
    avgDurationMs: count > 0 ? sumDurationMs / count : 0,
    avgConfidence: count > 0 ? sumConfidence / count : 0
  };
}

// ============================================
// Helpers
// ============================================

function createNullRouteFeatures(): RouteFeatures {
  return {
    route_exitProbability: null,
    route_pathEntropy: null,
    route_dumpRiskScore: null,
    route_cexTouched: null,
    route_bridgeTouched: null,
    route_mixerSuspected: null,
    route_swapSegmentsCount: null,
    route_bridgeSegmentsCount: null,
    route_hopCount: null,
    route_chainsCount: null,
    route_totalAmountUsd: null,
    route_durationMs: null,
    route_confidence: null
  };
}

/**
 * Get feature count for routes
 */
export function getRouteFeatureCount(): number {
  return 13;
}
