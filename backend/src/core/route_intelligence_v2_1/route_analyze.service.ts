/**
 * Route Analyze Orchestrator (P0.5)
 * 
 * Main pipeline:
 * 1. Build base route
 * 2. Detect CEX touches
 * 3. Enrich with swaps
 * 4. Resolve graph
 * 5. Score risk + confidence
 * 6. Persist routes_enriched
 * 7. Emit alerts + watchlist events
 */

import {
  RouteEnrichedModel,
  IRouteEnriched,
  ISegmentV2,
  RouteTypeV2,
  generateRouteIdV2
} from './storage/route_enriched.model.js';
import { generateRouteId, parseTimeWindow } from './builders/route_id.service.js';
import { buildBaseRoute, BaseRoute } from './builders/route_builder_v2_1.service.js';
import { enrichSegmentsWithSwaps, countSwaps } from './builders/swap_segment_enricher.service.js';
import { enrichSegmentsWithCEX, routeEndsCEX } from './builders/exchange_touch_detector.service.js';
import { resolveRouteGraph, getUniqueChains, getSegmentTypeCounts } from './builders/route_graph_resolver.service.js';
import { calculateExitProbability, isExitImminent } from './scoring/exit_probability.service.js';
import { calculatePathEntropy, isMixerSuspected } from './scoring/path_entropy.service.js';
import { calculateDumpRiskScore, shouldGenerateAlert, createRiskScores } from './scoring/dump_risk_score.service.js';
import { calculateRouteConfidence, hasAlertConfidence } from './scoring/route_confidence.service.js';

// ============================================
// Types
// ============================================

export interface AnalyzeOptions {
  window?: '1h' | '6h' | '24h' | '7d';
  forceRebuild?: boolean;
  skipAlerts?: boolean;
}

export interface AnalyzeResult {
  routeId: string;
  route: IRouteEnriched;
  isNew: boolean;
  alerts: Array<{ type: string; severity: string }>;
  watchlistEvents: Array<{ type: string; targetId: string }>;
}

// ============================================
// Main Analyze Function
// ============================================

/**
 * Analyze wallet and build enriched route
 */
export async function analyzeWallet(
  wallet: string,
  options: AnalyzeOptions = {}
): Promise<AnalyzeResult | null> {
  const { start: windowStart, end: windowEnd } = parseTimeWindow(options.window || '24h');
  
  // Generate route ID
  const routeId = generateRouteIdV2(wallet, windowStart, windowEnd);
  
  // Check if route already exists
  if (!options.forceRebuild) {
    const existing = await RouteEnrichedModel.findOne({ routeId }).lean();
    if (existing) {
      return {
        routeId,
        route: existing,
        isNew: false,
        alerts: [],
        watchlistEvents: []
      };
    }
  }
  
  // Step 1: Build base route
  const baseRoute = await buildBaseRoute(wallet, windowStart, windowEnd);
  
  if (!baseRoute || baseRoute.segments.length === 0) {
    return null;
  }
  
  // Step 2: Detect CEX touches
  const { segments: cexSegments, labels: cexLabels } = await enrichSegmentsWithCEX(baseRoute.segments);
  
  // Step 3: Enrich with swaps
  const swapResult = await enrichSegmentsWithSwaps(
    wallet,
    cexSegments,
    windowStart,
    windowEnd
  );
  
  // Step 4: Resolve graph
  const resolved = resolveRouteGraph(swapResult.segments);
  
  // Step 5: Calculate scores
  const pathEntropyResult = calculatePathEntropy(resolved.segments, wallet);
  
  const labels = {
    ...cexLabels,
    bridgeTouched: resolved.segments.some(s => s.type === 'BRIDGE'),
    mixerSuspected: isMixerSuspected(pathEntropyResult.entropy, pathEntropyResult.indicators),
    bridgeProtocols: extractBridgeProtocols(resolved.segments)
  };
  
  const exitResult = calculateExitProbability(resolved.segments, labels, pathEntropyResult.entropy);
  
  const totalAmountUsd = resolved.segments.reduce((sum, s) => sum + (s.amountUsd || 0), 0);
  
  const dumpRiskResult = calculateDumpRiskScore(
    resolved.segments,
    labels,
    exitResult,
    pathEntropyResult,
    totalAmountUsd
  );
  
  const confidenceResult = calculateRouteConfidence(
    resolved.segments,
    labels,
    baseRoute.chains
  );
  
  // Step 6: Classify route type
  const routeType = classifyRouteType(resolved.segments, labels, exitResult.probability);
  
  // Step 7: Build enriched route
  const { endsCEX, cexName } = await routeEndsCEX(resolved.segments);
  
  const enrichedRoute: IRouteEnriched = {
    routeId,
    wallet: wallet.toLowerCase(),
    timeWindowStart: windowStart,
    timeWindowEnd: windowEnd,
    routeType,
    chains: getUniqueChains(resolved.segments),
    startChain: baseRoute.startChain,
    endChain: baseRoute.endChain,
    segments: resolved.segments,
    segmentsCount: resolved.segments.length,
    swapsCount: countSwaps(resolved.segments),
    bridgesCount: resolved.segments.filter(s => s.type === 'BRIDGE').length,
    risk: createRiskScores(exitResult, pathEntropyResult, dumpRiskResult),
    confidence: confidenceResult.confidence,
    labels,
    startWallet: baseRoute.startWallet,
    endWallet: baseRoute.endWallet,
    startLabel: resolved.segments[0]?.fromLabel,
    endLabel: endsCEX ? cexName : resolved.segments[resolved.segments.length - 1]?.toLabel,
    totalAmountUsd: Math.round(totalAmountUsd),
    primaryToken: baseRoute.primaryToken,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    alertGenerated: false
  };
  
  // Step 8: Persist
  await RouteEnrichedModel.findOneAndUpdate(
    { routeId },
    enrichedRoute,
    { upsert: true, new: true }
  );
  
  // Step 9: Generate alerts (if applicable)
  const alerts: Array<{ type: string; severity: string }> = [];
  const watchlistEvents: Array<{ type: string; targetId: string }> = [];
  
  if (!options.skipAlerts && hasAlertConfidence(confidenceResult.confidence)) {
    const alertCheck = shouldGenerateAlert(
      dumpRiskResult.score,
      exitResult.probability,
      labels
    );
    
    if (alertCheck.shouldAlert) {
      alerts.push({
        type: routeType === 'EXIT' ? 'EXIT_ROUTE_DETECTED' : 'HIGH_RISK_ROUTE',
        severity: alertCheck.severity
      });
      
      // Update route with alert info
      await RouteEnrichedModel.updateOne(
        { routeId },
        { $set: { alertGenerated: true } }
      );
    }
  }
  
  console.log(
    `[RouteAnalyze] Analyzed ${wallet.slice(0, 10)}...: ` +
    `${resolved.segments.length} segments, ${swapResult.swapsAdded} swaps, ` +
    `risk=${dumpRiskResult.score}, exit=${exitResult.probability}`
  );
  
  return {
    routeId,
    route: enrichedRoute,
    isNew: true,
    alerts,
    watchlistEvents
  };
}

// ============================================
// Batch Analysis
// ============================================

/**
 * Analyze multiple wallets
 */
export async function analyzeWallets(
  wallets: string[],
  options: AnalyzeOptions = {}
): Promise<Map<string, AnalyzeResult | null>> {
  const results = new Map<string, AnalyzeResult | null>();
  
  for (const wallet of wallets) {
    try {
      const result = await analyzeWallet(wallet, options);
      results.set(wallet, result);
    } catch (error) {
      console.error(`[RouteAnalyze] Error analyzing ${wallet}:`, error);
      results.set(wallet, null);
    }
  }
  
  return results;
}

// ============================================
// Classification
// ============================================

/**
 * Classify route type
 */
function classifyRouteType(
  segments: ISegmentV2[],
  labels: { cexTouched: boolean; bridgeTouched: boolean; mixerSuspected: boolean },
  exitProbability: number
): RouteTypeV2 {
  // EXIT: ends at CEX or high exit probability with CEX touch
  if (labels.cexTouched && exitProbability >= 0.5) {
    return 'EXIT';
  }
  
  // Check if last segment is CEX deposit
  const lastSegment = segments[segments.length - 1];
  if (lastSegment?.type === 'CEX_DEPOSIT') {
    return 'EXIT';
  }
  
  // MIXING: high entropy, suspected mixer
  if (labels.mixerSuspected) {
    return 'MIXING';
  }
  
  // MIGRATION: multi-chain without CEX
  const chains = getUniqueChains(segments);
  if (chains.length > 1 && !labels.cexTouched) {
    return 'MIGRATION';
  }
  
  // INTERNAL: single chain
  if (chains.length === 1) {
    return 'INTERNAL';
  }
  
  return 'UNKNOWN';
}

/**
 * Extract bridge protocols from segments
 */
function extractBridgeProtocols(segments: ISegmentV2[]): string[] {
  const protocols = new Set<string>();
  
  for (const segment of segments) {
    if (segment.type === 'BRIDGE' && segment.protocol) {
      protocols.add(segment.protocol);
    }
  }
  
  return Array.from(protocols);
}

// ============================================
// Exports
// ============================================

export { parseTimeWindow };
