/**
 * ML Training Module Index (P0.8)
 * 
 * ML Lifecycle Management with enforced quality gates.
 * ML is a consumer, not source of truth.
 */

// Storage
export * from './storage/index.js';

// Services
export {
  enforceGates,
  checkGatesPreFlight,
  enforceGatesForDataset,
  enforceTrainingDatasetQuality,
  MLBlockedError,
  MIN_TRAINING_PASS_RATE,
  buildTrainingDataset,
  splitDataset,
  getDatasetStats,
  startTraining,
  validateAndActivateModel,
  getTrainingStatus,
  runInference,
  runBatchInference
} from './services/index.js';

// API
export { mlTrainingRoutes } from './api/index.js';
