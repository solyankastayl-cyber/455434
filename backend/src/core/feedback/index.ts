/**
 * Feedback Module Exports
 */
export * from './feedback.model.js';
export * from './feedback.routes.js';
export * from './feedback.schema.js';

// Re-export repository
export {
  upsertFeedback,
  getFeedbackBySource,
  getFeedbackByOutcome,
  getFeedbackStats,
  type CreateFeedbackInput,
  type UpdateFeedbackInput,
} from './feedback.repository.js';

// Re-export service
export {
  submitDecisionFeedback,
  submitActionFeedback,
  submitSimulationFeedback,
  getFeedback,
  getUserFeedbackHistory,
  getTargetFeedbackMetrics,
  getAvailableTags,
  analyzeDecisionQuality,
  getStats as getFeedbackServiceStats,
} from './feedback.service.js';
