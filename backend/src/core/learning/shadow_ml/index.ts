/**
 * Shadow ML Module Index
 * 
 * ETAP 4: Shadow ML exports.
 */

// Types
export * from './shadow_ml.types.js';

// Models
export { ShadowPredictionModel, type IShadowPrediction } from './shadow_prediction.model.js';

// Client
export {
  checkMLServiceHealth,
  getMLServiceStatus,
  trainShadowModel,
  getShadowPredictions,
  getEvaluation,
  getFeatureList,
} from './shadow_ml.client.js';

// Service
export {
  isShadowMLAvailable,
  getShadowMLStatus,
  trainModel,
  runInference,
  calculateFinalConfidence,
  getCalibration,
  evaluate,
  getPredictionsByToken,
  getPredictionStats,
  type InferenceResult,
} from './shadow_ml.service.js';

// Routes
export { shadowMLRoutes } from './shadow_ml.routes.js';
