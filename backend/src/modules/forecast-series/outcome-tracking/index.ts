/**
 * OUTCOME TRACKING MODULE INDEX
 * =============================
 * 
 * V3.4: Outcome Tracking
 * 
 * Exports all outcome tracking components.
 */

// Types
export type {
  EvaluationStatus,
  EvaluationResult,
  ForecastLayer,
  ForecastHorizon,
  ForecastSnapshot,
  ForecastOutcome,
  OutcomeStats,
} from './forecast-snapshot.types.js';

// Repositories
export {
  ForecastSnapshotRepo,
  getForecastSnapshotRepo,
} from './forecast-snapshot.repo.js';

export {
  ForecastOutcomeRepo,
  getForecastOutcomeRepo,
} from './forecast-outcome.repo.js';

// Service
export {
  OutcomeTrackerService,
  getOutcomeTrackerService,
  type PriceProvider,
} from './outcome-tracker.service.js';

// Job
export {
  OutcomeTrackerJob,
  getOutcomeTrackerJob,
  registerOutcomeTrackerJob,
  type OutcomeTrackerJobConfig,
} from './outcome-tracker.job.js';

// Routes
export { registerForecastOutcomeRoutes } from './forecast-outcome.routes.js';

console.log('[OutcomeTracking] V3.4 Module index loaded');
