/**
 * ASSETS MODULE INDEX
 * ===================
 * 
 * Canonical Asset + Multi-Venue Truth Layer
 * 
 * This module:
 * - Maintains asset universe
 * - Fetches data from multiple venues
 * - Resolves "truth" from observations
 * - Provides ML features
 * 
 * @sealed v1.0
 */

// Contracts
export * from './contracts/assets.types.js';

// Services
export * from './services/assets.registry.js';
export * from './services/truth.resolver.js';

// Adapters
export { getBinanceTicker, getBinanceMultipleTickers, checkBinanceHealth } from './adapters/binance.adapter.js';
export { getBybitTicker, getBybitMultipleTickers, checkBybitHealth } from './adapters/bybit.adapter.js';
export { getCoinbaseTicker, getCoinbaseMultipleTickers, checkCoinbaseHealth } from './adapters/coinbase.adapter.js';

// API
export { registerAssetsRoutes } from './api/assets.routes.js';

console.log('[Assets] Module initialized');
