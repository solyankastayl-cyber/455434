/**
 * C3 — Meta-Brain v2 Module
 * ==========================
 * 
 * Final decision layer for the Intelligence Engine.
 * 
 * ROLE:
 * Consolidate independent truths into one explainable decision
 * and honestly say when there is no decision.
 * 
 * Meta-Brain does NOT analyze the market.
 * It analyzes the CONSISTENCY of conclusions from other layers.
 * 
 * INVARIANTS:
 * - NO ML
 * - NO predictions  
 * - NO confidence upgrades
 * - ONLY deterministic rules
 * - FULL explainability via ReasonTree
 * 
 * DECISION HIERARCHY:
 * Truth (On-chain) > Mechanics (Exchange) > Intent (Sentiment)
 */

// Contracts
export * from './contracts/metaBrainV2.types.js';

// Matrix
export { runDecisionMatrix, getMatrixRules, DECISION_MATRIX_V1 } from './matrix/decision-matrix.v1.js';

// Services
export { buildContext, buildContextFromInputs } from './services/context.builder.js';
export { processDecision } from './services/decision.engine.js';
export { applyAllGuards } from './services/guards.engine.js';

// Storage
export { 
  MetaBrainDecisionModel, 
  saveDecision, 
  getLatestDecision, 
  getDecisionHistory,
  getDecisionStats,
} from './storage/metaBrainV2.model.js';

// Routes
export { metaBrainV2Routes } from './routes/metaBrainV2.routes.js';

console.log('[C3] Meta-Brain v2 Module loaded');
