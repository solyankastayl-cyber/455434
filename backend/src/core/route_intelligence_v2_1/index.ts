/**
 * Route Intelligence v2.1 Module (P0.5)
 * 
 * SWAP-enriched routes with exit probability and risk scoring.
 */

// Storage
export {
  RouteEnrichedModel,
  generateRouteIdV2,
  routeExistsV2,
  getRouteByIdV2,
  getRoutesByWalletV2,
  getHighRiskRoutesV2,
  getExitRoutesV2,
  getRouteStatsV2
} from './storage/route_enriched.model.js';

export type {
  IRouteEnriched,
  IRouteEnrichedDocument,
  ISegmentV2,
  IRiskScores,
  IRouteLabels,
  SegmentTypeV2,
  RouteTypeV2
} from './storage/route_enriched.model.js';

// Builders
export {
  generateRouteId,
  generateAlertId,
  generateWatchlistEventId,
  parseTimeWindow,
  getWindowString
} from './builders/route_id.service.js';

export {
  buildBaseRoute,
  getEventsForWallets,
  BUILDER_CONFIG
} from './builders/route_builder_v2_1.service.js';

export type { BaseRoute, BuilderConfig } from './builders/route_builder_v2_1.service.js';

export {
  enrichSegmentsWithSwaps,
  hasSwapBeforeExitPattern,
  hasSwapToStablePattern,
  countSwaps,
  ENRICHER_CONFIG
} from './builders/swap_segment_enricher.service.js';

export type { SwapEnrichmentResult, SwapMatch } from './builders/swap_segment_enricher.service.js';

export {
  checkCEXAddress,
  detectCEXTouches,
  enrichSegmentsWithCEX,
  routeEndsCEX,
  countCEXDeposits,
  countCEXWithdrawals,
  refreshCEXCache
} from './builders/exchange_touch_detector.service.js';

export type { CEXDetectionResult } from './builders/exchange_touch_detector.service.js';

export {
  resolveRouteGraph,
  getUniqueChains,
  getUniqueCounterparties,
  getSegmentTypeCounts,
  getRouteDuration,
  RESOLVER_CONFIG
} from './builders/route_graph_resolver.service.js';

export type { ResolvedRoute } from './builders/route_graph_resolver.service.js';

// Scoring
export {
  calculateExitProbability,
  getExitRiskLevel,
  isExitImminent,
  EXIT_SIGNALS
} from './scoring/exit_probability.service.js';

export type { ExitProbabilityResult } from './scoring/exit_probability.service.js';

export {
  calculatePathEntropy,
  isMixerSuspected,
  getEntropyLevel,
  ENTROPY_CONFIG
} from './scoring/path_entropy.service.js';

export type { PathEntropyResult } from './scoring/path_entropy.service.js';

export {
  calculateDumpRiskScore,
  getRiskLevel,
  shouldGenerateAlert,
  createRiskScores,
  DUMP_RISK_CONFIG
} from './scoring/dump_risk_score.service.js';

export type { DumpRiskResult } from './scoring/dump_risk_score.service.js';

export {
  calculateRouteConfidence,
  hasAlertConfidence,
  getConfidenceLevel,
  CONFIDENCE_CONFIG
} from './scoring/route_confidence.service.js';

export type { ConfidenceResult } from './scoring/route_confidence.service.js';

// Main orchestrator
export {
  analyzeWallet,
  analyzeWallets
} from './route_analyze.service.js';

export type { AnalyzeOptions, AnalyzeResult } from './route_analyze.service.js';

// Routes
export { default as routesV21Routes } from './api/routes_v2_1.routes.js';
