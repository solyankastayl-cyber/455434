/**
 * AE/S-Brain v2 — Module Index
 * 
 * Intelligence layer that reads system state and outputs directives.
 */

// Contracts
export * from './contracts/asset_state.contract.js';
export * from './contracts/world_state.contract.js';
export * from './contracts/brain_output.contract.js';

// Services
export { getAssetStateService } from './services/asset_state.service.js';
export { getWorldStateService } from './services/world_state.service.js';
export { getBrainOrchestratorService } from './services/brain_orchestrator.service.js';
export { getBrainOverrideApplyService } from './services/brain_override_apply.service.js';

// Routes
export { brainRoutes } from './routes/brain.routes.js';
