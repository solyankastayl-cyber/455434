/**
 * Cross-chain Module Index - ETAP B2
 * 
 * Re-exports all cross-chain functionality
 */

// ETAP B2: Exit detection
export * from './cross_chain.types.js';
export * from './bridge_registry.js';
export * from './cross_chain_detector.js';

// P2.3.2: API routes (existing)
export { default as crossChainRoutes } from './api/cross_chain.routes.js';
