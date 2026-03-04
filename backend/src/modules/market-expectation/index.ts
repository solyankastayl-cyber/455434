/**
 * MARKET EXPECTATION MODULE INDEX
 * ================================
 * 
 * Decision intelligence, NOT price forecasting.
 * 
 * This module:
 * - Does NOT touch trading
 * - Does NOT touch Connections  
 * - Does NOT break Meta-Brain
 * - Only subscribes to verdicts
 * 
 * @sealed v1.0
 */

// Contracts
export * from './contracts/expectation.types.js';
export * from './contracts/expectation.outcome.types.js';

// Services
export * from './services/expectation.builder.js';
export * from './services/expectation.store.js';
export * from './services/expectation.evaluator.js';
export * from './services/expectation.feedback.js';

// API
export { registerMarketExpectationRoutes } from './api/market-expectation.routes.js';

console.log('[MarketExpectation] Module initialized');
