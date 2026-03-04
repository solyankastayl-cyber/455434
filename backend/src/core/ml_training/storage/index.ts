/**
 * ML Training Storage Index (P0.8)
 */

export {
  MLModelModel,
  generateModelId,
  createModel,
  getActiveModel,
  getModelById,
  listModels,
  updateModelStatus,
  activateModel,
  getModelStats
} from './ml_model.model.js';

export type {
  ModelStatus,
  ModelType,
  IModelMetrics,
  IMLModel
} from './ml_model.model.js';

export {
  TrainingRunModel,
  generateRunId,
  createTrainingRun,
  updateTrainingRun,
  getTrainingRun,
  listTrainingRuns,
  getTrainingRunStats
} from './ml_training_run.model.js';

export type {
  TrainingRunStatus,
  TrainingTrigger,
  ITrainingRunConfig,
  ITrainingRunMetrics,
  ITrainingRun
} from './ml_training_run.model.js';

export {
  InferenceLogModel,
  generateInferenceId,
  logInference,
  getInferenceLog,
  getEntityInferences,
  getInferenceStats
} from './ml_inference_log.model.js';

export type {
  IInferenceInput,
  IInferenceOutput,
  IInferenceLog
} from './ml_inference_log.model.js';
