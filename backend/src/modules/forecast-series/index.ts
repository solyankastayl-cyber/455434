/**
 * FORECAST SERIES MODULE INDEX
 * ============================
 * 
 * BLOCK F1: Forecast Persistence + Candle Engine
 * 
 * Exports all forecast series components for app integration.
 */

// Types
export type {
  ForecastModelKey,
  ForecastHorizon,
  ForecastDirection,
  ForecastPoint,
  ForecastCandle,
  ForecastSeriesResponse,
  SnapshotRequest,
} from './forecast-series.types.js';

// Repository
export { 
  ForecastSeriesRepo, 
  getForecastSeriesRepo 
} from './forecast-series.repo.js';

// Candle Engine
export { 
  buildForecastCandle, 
  buildForecastCandles, 
  buildForecastLine 
} from './forecast-candle.engine.js';

// Snapshot Service
export { 
  ForecastSnapshotService, 
  getForecastSnapshotService,
  type VerdictLike 
} from './forecast-snapshot.service.js';

// Routes
export { registerForecastSeriesRoutes } from './forecast-series.routes.js';

// V3.2: Forecast-Only Routes (Brownian Bridge)
export { registerForecastOnlyRoutes, type ForecastOnlyResponse } from './forecast-only.routes.js';

// V3.2: Brownian Bridge Engine
export { buildBrownianBridgeCandles, estimateDailyVolPct, type BridgeCandle, type BridgeInput } from './brownian-bridge.engine.js';

// Job
export { 
  ForecastSnapshotJob,
  getForecastSnapshotJob,
  registerForecastSnapshotJob,
  type SnapshotJobConfig 
} from './forecast-snapshot.job.js';

// V3.4: Outcome Tracking
export {
  // Types
  type EvaluationStatus,
  type EvaluationResult,
  type ForecastSnapshot,
  type ForecastOutcome,
  type OutcomeStats,
  type PriceProvider,
  type OutcomeTrackerJobConfig,
  // Repos
  ForecastSnapshotRepo,
  getForecastSnapshotRepo,
  ForecastOutcomeRepo,
  getForecastOutcomeRepo,
  // Service
  OutcomeTrackerService,
  getOutcomeTrackerService,
  // Job
  OutcomeTrackerJob,
  getOutcomeTrackerJob,
  registerOutcomeTrackerJob,
  // Routes
  registerForecastOutcomeRoutes,
} from './outcome-tracking/index.js';

// V3.5-V3.10: Quality Engine
export {
  // V3.5-V3.6: Quality Service + Routes
  ForecastQualityService,
  getForecastQualityService,
  registerForecastQualityRoutes,
  type QualityState,
  type QualityParams,
  type QualityResult,
  // V3.7: Drift Service + Routes
  ForecastDriftService,
  getForecastDriftService,
  registerForecastDriftRoutes,
  type DriftState,
  type DriftParams,
  type DriftResult,
  // V3.8: Confidence Modifier
  ForecastConfidenceModifierService,
  getForecastConfidenceModifierService,
  type HealthState,
  type ConfidenceModifierInput,
  type ConfidenceModifierResult,
  // V3.9-V3.10: Position Sizing
  PositionSizingService,
  getPositionSizingService,
  type RiskLevel,
  type NotionalHint,
  type Action,
  type PositionSizingInput,
  type PositionSizingResult,
} from './quality/index.js';

console.log('[ForecastSeries] Module index loaded (Block F1 + V3.4 + V3.5-V3.10)');
