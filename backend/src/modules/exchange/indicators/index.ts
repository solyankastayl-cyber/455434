/**
 * S10.6I — Market Indicators Layer
 * 
 * Module Index
 */

// Types
export * from './indicator.types.js';

// Registry
export * from './indicator.registry.js';

// Service
export * from './indicator.service.js';

// Snapshot Builder (S10.6I.6)
export * from './indicator.snapshot.js';

// Aggregates (S10.6I.7)
export * from './indicator.aggregates.js';

// Routes
export { indicatorRoutes, indicatorAdminRoutes } from './indicator.routes.js';

// Calculators (for direct access if needed)
export { priceStructureCalculators } from './calculators/price-structure/index.js';
export { momentumCalculators } from './calculators/momentum/index.js';
export { volumeCalculators } from './calculators/volume/index.js';
export { orderBookCalculators } from './calculators/order-book/index.js';
export { positioningCalculators } from './calculators/positioning/index.js';

// S10.W — Whale Calculators
export { whaleCalculators, updateWhaleCache, getCachedWhaleState, getCachedWhaleIndicators } from './calculators/whale.calculators.js';

console.log('[S10.6I] Market Indicators Layer module loaded');
