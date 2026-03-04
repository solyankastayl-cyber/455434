/**
 * Neural Layer Module Index
 */

// Types
export type {
  MLMode,
  MLStatus,
  ConfidenceCalibration,
  OutcomePrediction,
  RankingAssist,
  NeuralOutput,
  ModelQuality,
  TrainingStatus,
  MLHealthStatus,
} from './neural.types.js';

// Model
export { NeuralModelModel, type INeuralModel } from './neural_model.model.js';

// Training Service
export {
  isTrainingAllowed,
  getTrainingStatus,
  trainCalibrationModel,
  trainOutcomeModel,
  getActiveModels,
} from './neural_training.service.js';

// Inference Service
export {
  getMLMode,
  getMLHealth,
  calibrateConfidence,
  predictOutcome,
  calculateRankingAssist,
  getNeuralOutput,
} from './neural_inference.service.js';
