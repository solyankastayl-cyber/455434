/**
 * Learning Control Module Exports (Phase 12C)
 */
export * from './learning_control.model.js';
export * from './legacy_access_log.model.js';
export * from './learning_control.routes.js';

export {
  getOrCreateLearningControl,
  checkDriftGuard,
  freezeLearning,
  unfreezeLearning,
  resetAdaptiveWeights,
  calculateHealthScore,
  getEffectiveLearningRate,
  getLearningControlStats,
  logLegacyAccess,
  getLegacyAccessStats,
} from './learning_control.service.js';
