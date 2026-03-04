/**
 * Route Intelligence Module (P0.3)
 * 
 * Bridge & Route Intelligence v2 - Cross-chain liquidity path analysis
 */

// Models
export { 
  LiquidityRouteModel, 
  generateRouteId 
} from './liquidity_route.model.js';

export type {
  ILiquidityRoute, 
  ILiquidityRouteDocument,
  RouteType,
  RouteStatus
} from './liquidity_route.model.js';

export { 
  RouteSegmentModel
} from './route_segment.model.js';

export type {
  IRouteSegment, 
  IRouteSegmentDocument,
  SegmentType 
} from './route_segment.model.js';

// Services
export {
  buildRoutesFromEvents,
  markStaleRoutes,
  recomputeRouteMetrics,
  getRoutesNeedingRecompute,
  BUILDER_CONFIG
} from './route_builder.service.js';

export {
  calculateRouteConfidence,
  isValidRouteSequence,
  calculateSegmentConnection,
  WEIGHTS as CONFIDENCE_WEIGHTS,
  THRESHOLDS as CONFIDENCE_THRESHOLDS
} from './route_confidence.service.js';

export type {
  ConfidenceFactors,
  ConfidenceResult
} from './route_confidence.service.js';

export {
  classifyRoute,
  detectDumpPattern,
  detectAccumulationPattern,
  getRouteSeverity
} from './route_classifier.service.js';

export type {
  RouteSeverity
} from './route_classifier.service.js';

export {
  resolveAddressLabel,
  resolveRouteLabels,
  isCEXAddress,
  isBridgeAddress,
  getCEXName,
  batchResolveAddresses
} from './route_label_resolver.js';

export type {
  ResolvedLabel,
  RouteEndpointLabels
} from './route_label_resolver.js';

// High-level service
export {
  getRoutes,
  getRouteWithSegments,
  getRoutesByWallet,
  getExitRoutes,
  getRouteStats,
  buildRoutesFromRecentEvents,
  rebuildWalletRoutes,
  analyzeWalletForDumps,
  getHighRiskRoutes,
  seedTestRoutes
} from './route_intelligence.service.js';

export type {
  RouteQueryOptions,
  RouteWithSegments,
  RouteStats,
  BuildRoutesResult
} from './route_intelligence.service.js';

// Routes
export { default as routeIntelligenceRoutes } from './route_intelligence.routes.js';
