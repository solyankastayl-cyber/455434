/**
 * Adaptive Module Exports
 */
export * from './adaptive_weights.model.js';
export * from './confidence_calibration.model.js';
export * from './strategy_reliability.model.js';
export * from './adaptive.routes.js';
export * from './adaptive.schema.js';

// Re-export service
export {
  initializeAdaptiveSystem,
  getWeights,
  getEffectiveScoreWeight,
  getEffectiveScoreWeights,
  processFeedbackForWeights,
  getConfidenceCalibration,
  getCalibratedConfidence,
  processSimulationForCalibration,
  recalibrateAllDecisionTypes,
  getStrategyReliability,
  getAllStrategyReliabilities,
  processSimulationForReliability,
  recalculateAllStrategyReliabilities,
  getAdaptiveExplanation,
  forceRecompute,
  getAdaptiveStats,
  ADAPTIVE_VERSION,
} from './adaptive.service.js';

// Re-export key repository functions
export {
  adjustWeight,
  getHighDriftWeights,
  getBoundaryWeights,
} from './adaptive_weights.repository.js';

export {
  getPoorlyCalibrated,
} from './confidence_calibration.repository.js';

export {
  getCopyRecommended,
  getStrategiesWithWarnings,
} from './strategy_reliability.repository.js';
