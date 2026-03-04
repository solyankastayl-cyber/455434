/**
 * PHASE 2.3 — Confidence Module Index
 * =====================================
 * 
 * Confidence Decay Engine for penalizing inaccurate verdicts.
 */

export * from './confidence.types.js';
export * from './confidence.engine.js';
export * from './confidence.service.js';
export { confidenceRoutes } from './confidence.routes.js';

console.log('[Phase 2.3] Confidence Module loaded');
