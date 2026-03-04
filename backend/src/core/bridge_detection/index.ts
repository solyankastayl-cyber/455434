/**
 * Bridge Detection Module
 * 
 * Detects cross-chain liquidity migrations by correlating watchlist events
 */

// Models
export * from './bridge_migration.model.js';

// Service
export * from './bridge_detection.service.js';

// Routes
export { bridgeDetectionRoutes } from './bridge_detection.routes.js';
