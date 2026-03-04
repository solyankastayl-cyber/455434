/**
 * C2.2 — Validation Module
 * =========================
 * 
 * Exchange × On-chain Validation Engine.
 * 
 * ROLE: Check if Exchange verdict is confirmed by on-chain reality.
 * RESULT: CONFIRMS | CONTRADICTS | NO_DATA
 * 
 * INVARIANTS:
 * - Validation does NOT change verdict
 * - Validation does NOT upgrade confidence
 * - Validation does NOT know about Sentiment
 * - Validation does NOT participate in ML
 */

// Re-export everything from engine
export * from './validation.engine.js';

export { ValidationResultModel } from './validation.model.js';
export { validationService } from './validation.service.js';
export { validationRoutes } from './validation.routes.js';

console.log('[C2.2] Validation Module loaded');
