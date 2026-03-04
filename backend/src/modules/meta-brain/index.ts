/**
 * S10.8 — Meta-Brain Module Index
 * 
 * P0.2 — Meta-Brain Hardening (Invariants & Guards)
 * P0.3 — Decision Context Contract
 */

export * from './meta-brain.types.js';
export * from './exchange-impact.js';
export * from './meta-brain.service.js';
export * from './meta-brain.guard.js';

// P0.2 — Formal Invariants
export * from './invariants/index.js';

// P0.2 — Guards
export * from './guards/index.js';

// P0.3 — Decision Context Contract
export * from './contracts/decision.context.js';

export { metaBrainRoutes, registerMetaBrainRoutes } from './meta-brain.routes.js';
