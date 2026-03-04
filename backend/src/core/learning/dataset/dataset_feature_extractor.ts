/**
 * Dataset Feature Extractor
 * 
 * ETAP 3.4: Pure functions for extracting features from source data.
 * 
 * NO DB calls - NO Date.now() - DETERMINISTIC
 */
import type { IPredictionSnapshot } from '../models/PredictionSnapshot.model.js';
import type { IAttributionOutcomeLink } from '../models/attribution_outcome_link.model.js';
import type { DriftLevel } from '../learning.types.js';
import type {
  FeatureVector,
  SnapshotFeatures,
  LiveFeatures,
  DriftFeatures,
  MarketFeatures,
} from '../types/dataset.types.js';

// ==================== DRIFT CONFIDENCE MODIFIERS ====================

const DRIFT_CONFIDENCE_MODIFIERS: Record<DriftLevel, number> = {
  LOW: 1.0,
  MEDIUM: 0.85,
  HIGH: 0.6,
  CRITICAL: 0.3,
};

// ==================== FEATURE EXTRACTORS ====================

/**
 * Extract snapshot features from PredictionSnapshot
 */
export function extractSnapshotFeatures(
  snapshot: IPredictionSnapshot,
  link?: IAttributionOutcomeLink
): SnapshotFeatures {
  // Get top signals from link if available
  const topPositive = link?.signalContrib?.positiveSignals?.map(s => s.key) || [];
  const topNegative = link?.signalContrib?.negativeSignals?.map(s => s.key) || [];
  
  return {
    bucket: snapshot.decision.bucket,
    compositeScore: snapshot.decision.score,
    engineScore: snapshot.decision.score, // Same in v1
    engineConfidence_raw: snapshot.decision.confidence,
    risk_raw: snapshot.decision.risk,
    coverageLevel: snapshot.engineContext.coverageLevel,
    engineMode: snapshot.engineContext.engineMode,
    actorSignalScore: snapshot.engineContext.actorSignalScore,
    topPositiveSignals: topPositive,
    topNegativeSignals: topNegative,
  };
}

/**
 * Extract LIVE features from approved aggregate window
 * If no approved data, returns zeroed features with NONE coverage
 */
export function extractLiveFeatures(
  approvedWindow?: {
    netFlow?: number;
    inflow?: number;
    outflow?: number;
    uniqueSenders?: number;
    uniqueReceivers?: number;
    exchangeInflow?: number;
    exchangeOutflow?: number;
    liquidityChangePct?: number;
    eventCount?: number;
  } | null
): LiveFeatures {
  if (!approvedWindow) {
    return {
      live_netFlow: 0,
      live_inflow: 0,
      live_outflow: 0,
      live_uniqueSenders: 0,
      live_uniqueReceivers: 0,
      live_exchangeInflow: 0,
      live_exchangeOutflow: 0,
      live_liquidityChangePct: 0,
      live_eventCount: 0,
      liveCoverage: 'NONE',
    };
  }
  
  // Determine coverage level
  const hasFlow = (approvedWindow.netFlow ?? 0) !== 0 || 
                  (approvedWindow.inflow ?? 0) !== 0;
  const hasExchange = (approvedWindow.exchangeInflow ?? 0) !== 0 ||
                      (approvedWindow.exchangeOutflow ?? 0) !== 0;
  
  const liveCoverage = hasFlow && hasExchange ? 'FULL' : 
                       hasFlow || hasExchange ? 'PARTIAL' : 'NONE';
  
  return {
    live_netFlow: approvedWindow.netFlow ?? 0,
    live_inflow: approvedWindow.inflow ?? 0,
    live_outflow: approvedWindow.outflow ?? 0,
    live_uniqueSenders: approvedWindow.uniqueSenders ?? 0,
    live_uniqueReceivers: approvedWindow.uniqueReceivers ?? 0,
    live_exchangeInflow: approvedWindow.exchangeInflow ?? 0,
    live_exchangeOutflow: approvedWindow.exchangeOutflow ?? 0,
    live_liquidityChangePct: approvedWindow.liquidityChangePct ?? 0,
    live_eventCount: approvedWindow.eventCount ?? 0,
    liveCoverage,
  };
}

/**
 * Extract drift features from snapshot's live context
 */
export function extractDriftFeatures(snapshot: IPredictionSnapshot): DriftFeatures {
  const driftLevel = (snapshot.liveContext.driftLevel || 'LOW') as DriftLevel;
  const driftScore = snapshot.liveContext.driftScore || 0;
  const confidenceModifier = DRIFT_CONFIDENCE_MODIFIERS[driftLevel] || 1.0;
  
  // Adjusted confidence
  const engineConfidence_adj = Math.round(
    Math.min(100, Math.max(0, snapshot.decision.confidence * confidenceModifier))
  );
  
  return {
    driftLevel,
    driftScore,
    confidenceModifier,
    engineConfidence_adj,
  };
}

/**
 * Extract market features from snapshot
 */
export function extractMarketFeatures(snapshot: IPredictionSnapshot): MarketFeatures {
  return {
    priceAtDecision: snapshot.market.priceAtDecision || 0,
    mcapAtDecision: snapshot.market.mcapAtDecision || 0,
    volumeAtDecision: snapshot.market.volumeAtDecision || 0,
    momentumAtDecision: snapshot.market.momentumAtDecision || 0,
  };
}

/**
 * Build complete feature vector
 */
export function buildFeatureVector(
  snapshot: IPredictionSnapshot,
  link?: IAttributionOutcomeLink,
  approvedWindow?: any
): FeatureVector {
  return {
    snapshot: extractSnapshotFeatures(snapshot, link),
    live: extractLiveFeatures(approvedWindow),
    drift: extractDriftFeatures(snapshot),
    market: extractMarketFeatures(snapshot),
  };
}
