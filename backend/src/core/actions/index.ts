/**
 * Actions Module Exports
 */
export * from './actions.model.js';
export * from './actions.routes.js';
export * from './actions.schema.js';

// Re-export repository (selectively to avoid conflicts with service)
export {
  createAction,
  getActionById,
  getActionsByDecision,
  updateActionStatus,
  getActionsStats,
  type CreateActionInput,
} from './actions.repository.js';

// Re-export service (main API)
export {
  generateActionsFromDecision,
  getSuggestedActions,
  acceptAction,
  dismissAction,
  getActionHistory,
  expireOldActions,
  getStats as getActionsServiceStats,
} from './actions.service.js';
