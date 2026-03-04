/**
 * BLOCK 79 — Proposal Module Index
 * 
 * Exports for proposal persistence and lifecycle management.
 */

// Types
export * from './types/proposal.types.js';

// Models
export { PolicyProposalModel } from './models/policy-proposal.model.js';
export { PolicyApplicationModel } from './models/policy-application.model.js';

// Services
export { policyStateService } from './services/policy-state.service.js';
export { proposalStoreService } from './services/proposal-store.service.js';
export { proposalApplyService } from './services/proposal-apply.service.js';
export { proposalRollbackService } from './services/proposal-rollback.service.js';

// Routes
export { proposalRoutes } from './proposal.routes.js';
