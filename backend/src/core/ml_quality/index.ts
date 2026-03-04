/**
 * ML Quality Module Index (P0.7)
 * 
 * Feature Coverage Gates & Data Quality.
 * Safety layer for ML - determines if data is usable.
 */

// Storage
export * from './storage/index.js';

// Analyzers
export {
  analyzeCoverage,
  checkCoverageThresholds,
  calculateQualityScore,
  analyzeFreshness,
  checkFreshnessThresholds
} from './analyzers/index.js';

// Gates
export {
  checkGates,
  checkGatesAndPersist,
  isAllowed,
  explainDecision,
  DEFAULT_GATE_CONFIG
} from './gates/index.js';

// Drift
export {
  calculateDistribution,
  checkFeatureDrift,
  checkBatchDrift
} from './drift/index.js';

// Integration
export {
  createGateAlert,
  createDriftAlert,
  resolveQualityAlerts
} from './integration/index.js';

// Routes
export { mlQualityRoutes } from './api/index.js';
