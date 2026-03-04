/**
 * Personalized Module Exports (Phase 12B)
 */
export * from './user_preferences.model.js';
export * from './user_bias.model.js';
export * from './user_signal_outcomes.model.js';
export * from './personalized.routes.js';

export {
  getOrCreatePreferences,
  updatePreferences,
  getOrCreateBias,
  updateBiasFromOutcome,
  calculatePersonalizedScore,
  recordSignalDecision,
  evaluateSignalOutcome,
  getUserPersonalizationStats,
} from './personalized.service.js';

export type {
  PersonalizedScoreInput,
  PersonalizedScoreOutput,
} from './personalized.service.js';
