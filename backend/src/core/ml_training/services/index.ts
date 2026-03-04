/**
 * ML Training Services Index (P0.8)
 */

export {
  enforceGates,
  checkGatesPreFlight,
  enforceGatesForDataset,
  enforceTrainingDatasetQuality,
  MLBlockedError,
  MIN_TRAINING_PASS_RATE
} from './gate_enforcer.service.js';

export type { EnforcementResult } from './gate_enforcer.service.js';

export {
  buildTrainingDataset,
  splitDataset,
  getDatasetStats
} from './dataset_builder.service.js';

export type {
  DatasetConfig,
  TrainingSample,
  TrainingDataset
} from './dataset_builder.service.js';

export {
  startTraining,
  validateAndActivateModel,
  getTrainingStatus
} from './training_orchestrator.service.js';

export type {
  TrainingRequest,
  TrainingResult
} from './training_orchestrator.service.js';

export {
  runInference,
  runBatchInference
} from './inference.service.js';

export type {
  InferenceRequest,
  InferenceResult
} from './inference.service.js';
