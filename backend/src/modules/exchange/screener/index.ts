/**
 * ALT SCREENER MODULE INDEX
 * ==========================
 * Blocks 1.4 + 1.5 (Pattern Matching + ML)
 */

// Contracts
export * from './contracts/alt.feature.vector.js';

// Core services
export * from './alt.feature.builder.js';
export * from './pattern.space.js';
export * from './similarity.js';
export * from './alt.labeler.js';
export * from './winner.memory.js';
export * from './alt.candidates.js';

// ML layer
export * from './ml/index.js';

// Routes
export { registerScreenerRoutes } from './screener.routes.js';

console.log('[Screener] Module loaded (Blocks 1.4-1.5)');
