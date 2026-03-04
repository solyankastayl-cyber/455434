/**
 * SPX CORE — Module Index
 * 
 * BLOCK B5.2 — SPX Fractal Core Module
 * 
 * Re-exports all SPX Core functionality.
 */

// Routes
export { registerSpxCoreRoutes } from './spx-core.routes.js';

// Focus Pack Builder
export { 
  buildSpxFocusPack,
  type SpxFocusPack,
  type SpxFocusPackMeta,
  type SpxOverlayPack,
  type SpxOverlayMatch,
  type SpxForecastPack,
  type SpxPrimarySelection,
  type SpxNormalizedSeries,
  type SpxFocusPackDiagnostics,
} from './spx-focus-pack.builder.js';

// Horizon Config
export {
  SPX_HORIZON_CONFIG,
  getSpxHorizonConfig,
  getAllSpxHorizons,
  getSpxHorizonTier,
  isValidSpxHorizon,
  type SpxHorizonKey,
  type SpxHorizonConfig,
} from './spx-horizon.config.js';

// Services
export { spxCandlesService, type SpxCandle } from './spx-candles.service.js';
export { scanSpxMatches, scanSpxMatchesForWindow, type SpxRawMatch, type SpxScanConfig, type SpxScanResult } from './spx-scan.service.js';
export { buildReplayPath, buildSyntheticPath, buildDistributionSeries, type PathPoint, type ReplayPath, type SyntheticPath } from './spx-replay.service.js';
export { selectPrimaryMatch, rankAllMatches, getHorizonTier, type SpxPrimaryMatch, type SpxPrimarySelectionResult, type SpxHorizonTier } from './spx-primary-selector.service.js';
export { calculateDivergence, type SpxDivergenceMetrics, type SpxAxisMode, type SpxDivergenceGrade, type SpxDivergenceFlag } from './spx-divergence.service.js';
export { detectPhase, detectPhaseFromCloses, detectPhaseAtIndex, type SpxPhase, type SpxPhaseResult } from './spx-phase.service.js';

// Utilities
export { normalizeSeries, zScoreNormalize, minMaxNormalize, computeReturns } from './spx-normalize.js';
export { computeSimilarity, computeCorrelation, computeRMSE, computeDTWLite } from './spx-match.service.js';
