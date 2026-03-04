/**
 * S10.W — Whale Intelligence Module
 * 
 * Large Position Tracking & Whale Mechanics
 * 
 * Exports:
 * - Types
 * - Services
 * - Routes
 * - Mock Generator
 * - Providers (Step 2)
 * - Patterns (Step 5)
 * 
 * NO SIGNALS, NO PREDICTIONS — only measurements.
 */

// Types
export * from './whale.types.js';

// Services
export * from './whale-state.service.js';
export * from './whale-storage.service.js';
export * from './whale-mock.generator.js';

// Providers (Step 2)
export * from './providers/index.js';

// Patterns (Step 5)
export * from './patterns/index.js';

// Routes
export { whaleRoutes, whaleAdminRoutes } from './whale.routes.js';

// Ingest Job
export { runWhaleIngest, getIngestStatus } from './whale-ingest.job.js';

console.log('[S10.W] Whale Intelligence Module loaded');
