/**
 * PHASE 1 — Network Module Index
 * ================================
 * 
 * Network layer for proxy control and HTTP client management.
 */

export * from './network.config.types.js';
export * from './network.config.service.js';
export * from './httpClient.factory.js';
export * from './network.health.service.js';
export { networkAdminRoutes } from './network.routes.js';

console.log('[Phase 1] Network Module loaded');
