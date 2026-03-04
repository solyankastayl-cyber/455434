/**
 * Market Module Exports (Phase 14A)
 */
export * from './dex_pairs.model.js';
export * from './price_points.model.js';
export * from './market_metrics.model.js';
export * from './market.routes.js';

export {
  initializeDexPairs,
  fetchV2Reserves,
  calculateV2Price,
  calculateConfidence,
  fetchAndStorePairPrice,
  storePricePoint,
  getLatestPrice,
  getPriceHistory,
  getWethPriceUsd,
} from './price.service.js';

export {
  calculateVolatility,
  calculateTrend,
  calculateMaxDrawdown,
  calculateMarketMetrics,
  getMarketMetrics,
  getTopAssets,
} from './market_metrics.service.js';
