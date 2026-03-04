/**
 * ML Retrain Module
 * 
 * BATCH 1: Очередь, контроль, версии, SHADOW по умолчанию.
 * BATCH 2: Python Training Service integration.
 * BATCH 3: Shadow Inference + Evaluation.
 * BATCH 4: Promotion / Rollback Engine.
 * ML v2.2: Auto-Retrain Policy Engine.
 * ML v2.3: Feature Pruning + Sample Weighting.
 * 
 * Production-grade self-learning loop:
 * DATA → TRAIN → SHADOW → EVAL → PROMOTE → ACTIVE → VALIDATE → RETRAIN
 */

// Models
export { MlRetrainQueueModel, type IMlRetrainQueue, type RetrainStatus, type RetrainReason } from './ml_retrain_queue.model.js';
export { MlModelRegistryModel, type IMlModelRegistry, type ModelStatus, type IModelMetrics } from './ml_model_registry.model.js';

// Services
export { RetrainExecutorService } from './retrain_executor.service.js';
export { startRetrainScheduler, stopRetrainScheduler, isSchedulerRunning } from './retrain_scheduler.service.js';

// BATCH 2: Python ML Client
export { pyTrain, pyValidate, pyHealth, pyGetDatasets } from './python_ml.client.js';

// BATCH 2: Dataset Export
export { 
  exportMarketDataset, 
  exportActorDataset, 
  exportAllDatasets,
  startDatasetExportJob,
  stopDatasetExportJob,
  DatasetSnapshotModel
} from './dataset_export.service.js';

// BATCH 3: Shadow Evaluation
export {
  ShadowComparisonModel,
  ShadowRunnerService,
  adminMlShadowRoutes,
  SHADOW_EVAL_THRESHOLDS,
  makeVerdict,
  computeBinaryMetrics,
} from './shadow/index.js';

// BATCH 4: Promotion / Rollback
export {
  PromotionService,
  adminMlPromotionRoutes,
} from './promotion/index.js';

// ML v2.2: Auto-Retrain Policy
export {
  MlRetrainPolicyModel,
  MlAutoRetrainDecisionModel,
  AutoRetrainPolicyService,
  startAutoRetrainScheduler,
  stopAutoRetrainScheduler,
  seedDefaultPolicies,
  adminMlAutoRetrainRoutes,
} from './auto_retrain/index.js';

// ML v2.3: Feature Pruning + Sample Weighting
export {
  adminMlV23Routes,
  trainV23Shadow,
  pyTrainV23,
  DEFAULT_PRUNING,
  DEFAULT_WEIGHTING,
  DEFAULT_V23_SETTINGS,
} from './v23/index.js';

// Routes
export { adminMlRetrainRoutes } from './admin.ml.retrain.routes.js';
export { adminMlModelsRoutes } from './admin.ml.models.routes.js';
