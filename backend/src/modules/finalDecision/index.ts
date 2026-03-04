/**
 * PHASE 4 — Final Decision Module
 * =================================
 * Buy / Sell / Avoid policy engine
 */

// Types
export * from './contracts/decision.types.js';

// Storage
export { DecisionRecordModel } from './storage/decision.storage.js';

// Services
export { finalDecisionService } from './services/finalDecision.service.js';
export { buildDecisionContext } from './services/context.builder.js';

// Routes
export { registerDecisionRoutes } from './routes/decision.routes.js';

console.log('[Phase 4] Final Decision Module loaded');
