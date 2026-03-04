/**
 * Self-Learning Module Index
 * 
 * ETAP 5: Self-Learning Loop exports.
 */

// Types
export * from './self_learning.types.js';

// Models
export { SelfLearningRuntimeModel, type ISelfLearningRuntime } from './self_learning.runtime.model.js';
export { DatasetVersionModel, type IDatasetVersion } from './dataset_version.model.js';
export { ModelVersionModel, type IModelVersion } from './model_version.model.js';
export { ActiveModelStateModel, type IActiveModelState } from './active_model.state.js';
export { AuditLogModel, type IAuditLog, type AuditAction } from './audit_log.model.js';

// Services - PR #1
export * from './dataset_freezer.service.js';
export * from './dataset_hash.util.js';
export * from './retrain.guard.js';
export * from './retrain.scheduler.js';
export * from './model_trainer.service.js';

// Services - PR #2
export * from './train_config_hash.util.js';
export * from './training.runner.js';
export * from './model_registry.service.js';
export * from './metric_diff.util.js';
export * from './evaluation_policy.js';
export * from './evaluation_gate.service.js';

// Services - PR #3
export * from './model_promotion.service.js';
export * from './shadow_monitor.service.js';
export * from './confidence_adjuster.service.js';
export * from './audit_logger.service.js';

// Routes
export { selfLearningRoutes } from './self_learning.routes.js';
