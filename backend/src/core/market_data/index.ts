/**
 * Market Data Module Index (P1.5)
 * 
 * CEX/Market Context Layer.
 * Provides market context for ML features - NOT trading signals.
 */

// Storage
export * from './storage/index.js';

// Adapters
export {
  coingeckoAdapter,
  resolveSymbol,
  getSupportedSymbols,
  getDefaultSymbols,
  isSymbolSupported,
  getBestSource,
  normalizeSymbol
} from './adapters/index.js';

// Ingestion
export {
  syncSymbol,
  syncAllSymbols,
  backfillSymbol,
  getIngestionStatus
} from './ingestion/index.js';

// Aggregation
export {
  buildMetrics,
  buildAllMetrics,
  getMarketContext,
  getMultipleMarketContext,
  getMarketRegimeSummary,
  refreshMetrics
} from './aggregation/index.js';

// ML Features
export {
  extractMarketFeatures,
  getMarketFeatureCount
} from './ml/index.js';

// API
export { marketRoutes } from './api/index.js';
