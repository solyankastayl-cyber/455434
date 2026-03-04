/**
 * Simulations Module Exports
 */
export * from './simulations.model.js';
export * from './simulations.routes.js';
export * from './simulations.schema.js';

// Re-export repository
export {
  createSimulation,
  getSimulationById,
  getSimulationByDecision,
  addCheckpoint,
  getExpiredSimulations,
  getSimulationsStats,
  type CreateSimulationInput,
  type AddCheckpointInput,
} from './simulations.repository.js';

// Re-export service
export {
  startSimulationFromDecision,
  startSimulationFromAction,
  updateActiveSimulations,
  getSimulationForDecision,
  getSimulationsForTarget,
  getActiveSimulations,
  completeSimulation,
  invalidateSimulation,
  getPerformanceSummary,
  getStats as getSimulationsServiceStats,
} from './simulations.service.js';
