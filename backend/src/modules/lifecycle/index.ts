/**
 * UNIFIED LIFECYCLE MODULE
 * 
 * BLOCK L1 + L2 + L3 — Exports for lifecycle engine
 */

export * from './lifecycle.types.js';
export * from './lifecycle.service.js';
export * from './lifecycle.hooks.js';
export * from './lifecycle.integrity.js';
export { default as registerLifecycleRoutes } from './lifecycle.routes.js';

console.log('[Lifecycle] Module loaded (L1+L2+L3)');
