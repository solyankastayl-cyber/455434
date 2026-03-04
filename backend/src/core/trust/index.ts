/**
 * Trust Module Exports
 */
export * from './trust.model.js';
export * from './trust.routes.js';
export * from './trust.schema.js';

// Re-export repository
export {
  upsertTrust,
  getTrustByType,
  getTrustStats,
  type UpdateTrustInput,
} from './trust.repository.js';

// Re-export service
export {
  calculateDecisionTypeTrust,
  calculateActorTrust,
  calculateSystemTrust,
  getTrust,
  getSystemTrust,
  getTrustByDecisionType,
  getHighTrustActors,
  getTransparencyReport,
  getStats as getTrustServiceStats,
} from './trust.service.js';
