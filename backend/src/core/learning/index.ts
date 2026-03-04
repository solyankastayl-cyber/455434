/**
 * Learning Module Index
 * 
 * ETAP 3: Learning Intelligence
 * 
 * Exports all learning components.
 */

// Types
export * from './learning.types.js';
export * from './types/trend.types.js';
export * from './types/attribution.types.js';

// Models
export { PredictionSnapshotModel, type IPredictionSnapshot } from './models/PredictionSnapshot.model.js';
export { OutcomeObservationModel, type IOutcomeObservation } from './models/OutcomeObservation.model.js';
export { TrendValidationModel, type ITrendValidation } from './models/trend_validation.model.js';
export { AttributionOutcomeLinkModel, type IAttributionOutcomeLink } from './models/attribution_outcome_link.model.js';

// Services - Snapshot
export {
  createSnapshot,
  createSnapshotsBatch,
  getSnapshotById,
  getSnapshotsByToken,
  getSnapshotStats,
  getSnapshotsPendingOutcomes,
  type RankingInput,
  type SnapshotResult,
} from './services/snapshot.service.js';

// Services - Outcome Tracker
export {
  findMaturedSnapshots,
  trackOutcome,
  runOutcomeTrackingCycle,
  getOutcomeBySnapshotId,
  getOutcomesByToken,
  getOutcomeStats,
  getSnapshotWithOutcome,
  type TrackerResult,
  type TrackerDetail,
  type MaturedSnapshot,
} from './services/outcome-tracker.service.js';

// Services - Trend Validation (ETAP 3.2)
export {
  classifyHorizonTrend,
  classifyDelay,
  computeFinal,
  validateSnapshot,
  validateBatch,
  getValidationBySnapshotId,
  getValidationsByToken,
  getValidationStats,
  getPendingValidation,
  type ValidationResult,
  type ValidationBatchResult,
} from './services/trend-validation.service.js';

// Services - Attribution Link (ETAP 3.3)
export {
  computeVerdict,
  extractSignalContrib,
  applyDriftConfidenceModifier,
  buildLink,
  buildLinksForPendingSnapshots,
  getLinkBySnapshotAndHorizon,
  getLinksByToken,
  getLinkStats,
  getPendingForLinking,
  type LinkResult,
  type LinkBatchResult,
} from './services/attribution_outcome_link.service.js';

// Workers
export {
  startOutcomeWorker,
  stopOutcomeWorker,
  getOutcomeWorkerStatus,
  runOutcomeWorkerOnce,
} from './workers/outcome-tracker.worker.js';

export {
  startTrendWorker,
  stopTrendWorker,
  getTrendWorkerStatus,
  runTrendWorkerOnce,
} from './workers/trend-validation.worker.js';

export {
  startAttributionWorker,
  stopAttributionWorker,
  getAttributionWorkerStatus,
  runAttributionWorkerOnce,
  runAttributionWorkerAll,
} from './workers/attribution_outcome_link.worker.js';

// Routes
export { learningRoutes } from './routes/learning.routes.js';
export { trendRoutes } from './routes/trend.routes.js';
export { attributionLinkRoutes } from './routes/attribution_outcome_link.routes.js';

// Dataset (ETAP 3.4)
export * from './dataset/index.js';

// Shadow ML (ETAP 4)
export * from './shadow_ml/index.js';
