/**
 * FUNDING MODULE INDEX
 * ====================
 * Blocks 1.1 - 1.3 + Block 2.8 (Multi-venue funding features)
 */

// Types
export * from './contracts/funding.types.js';
export * from './contracts/funding.adapter.js';
export * from './contracts/funding.normalized.js';
export * from './contracts/funding.context.js';

// Block 2.8 — Funding Observation Model
export * from './db/funding_observation.model.js';

// Adapters
export { binanceFundingAdapter } from './adapters/binance.funding.adapter.js';
export { bybitFundingAdapter } from './adapters/bybit.funding.adapter.js';
export { hyperliquidFundingAdapter } from './adapters/hyperliquid.funding.adapter.js';
export { coinbaseFundingAdapter } from './adapters/coinbase.funding.adapter.js';

// Registry & Services
export { FundingRegistry } from './funding.registry.js';
export { FundingNormalizer, fundingNormalizer } from './funding.normalizer.js';
export { FundingContextClassifier, fundingContextClassifier } from './funding.context.classifier.js';
export { FundingStore } from './funding.store.js';
export { FundingService, fundingService } from './funding.service.js';

// Block 2.8 — Funding Aggregator Service
export { FundingAggregatorService, fundingAggregatorService } from './services/funding_aggregator.service.js';

// Routes
export { registerFundingRoutes } from './funding.routes.js';
export { registerAdminFundingDebugRoutes } from './routes/admin_funding_debug.routes.js';

console.log('[Funding] Module loaded (Blocks 1.1-1.3 + 2.8)');
