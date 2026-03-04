/**
 * DEX Layer Module (P0.4)
 * 
 * Uniswap v3 swap event ingestion and analysis.
 * Provides intent signals for Route Intelligence and ML features.
 */

// Storage
export {
  DexTradeModel,
  generateTradeId,
  tradeExists,
  getTradesByWallet,
  getTradesByToken,
  getDexStats,
  DEX_CHAIN_CONFIG
} from './storage/dex_trade.model.js';

export type {
  IDexTrade,
  IDexTradeDocument,
  DexProtocol,
  SupportedDexChain
} from './storage/dex_trade.model.js';

// Adapters
export {
  decodeSwapLog,
  normalizeSwap,
  toDexTrade,
  processSwapLogs,
  fetchSwapLogs,
  fetchSwapLogsWithTimestamps,
  getPoolTokens,
  clearPoolCache,
  determineTradeDirection,
  getTokenSymbol,
  isStablecoin,
  SWAP_EVENT_TOPIC,
  CHAIN_IDS,
  INGESTION_CONFIG
} from './adapters/uniswap_v3.adapter.js';

export {
  UNISWAP_V3_FACTORY,
  FEE_TIERS,
  KNOWN_TOKENS,
  STABLECOINS,
  SWAP_EVENT_ABI,
  POOL_ABI
} from './adapters/uniswap_v3.constants.js';

// Ingestion
export {
  safeBatchInsert,
  deduplicateBatch,
  filterNewTrades,
  validateTrade,
  prepareTradesForInsert
} from './ingestion/dex_deduplicator.js';

export type {
  DeduplicationResult,
  BatchInsertResult
} from './ingestion/dex_deduplicator.js';

export {
  ingestSwapsForRange,
  ingestSwapsInBatches,
  ingestRecentSwaps,
  ingestAllChains,
  getIngestionStatus,
  seedTestTrades,
  getProvider,
  getRpcUrl,
  clearProviderCache
} from './ingestion/dex_ingestor.service.js';

export type {
  IngestionResult,
  IngestionStats
} from './ingestion/dex_ingestor.service.js';

// Pricing
export {
  getTokenUsdValue,
  getStablecoinValue,
  priceTrades,
  estimateTradeValue,
  getFallbackPrice,
  clearPriceCache
} from './pricing/usd_pricer.service.js';

export type {
  PriceResult,
  TokenPrice
} from './pricing/usd_pricer.service.js';

// Aggregation
export {
  getWalletDexSummary,
  getTokenDexSummary,
  getRecentSwapActivity,
  findSwapsBeforeExit,
  hadSwapActivity
} from './aggregation/dex_aggregator.service.js';

export type {
  WalletDexSummary,
  TokenDexSummary,
  RecentSwapActivity
} from './aggregation/dex_aggregator.service.js';

// Routes
export { default as dexRoutes } from './api/dex.routes.js';

// Route Intelligence Integration
export {
  findWalletSwaps,
  findSwapsNearTimestamp,
  dexTradeToSegment,
  dexTradesToSegments,
  enrichRouteWithSwaps,
  enrichRoutesWithSwaps,
  detectSwapBeforeExit,
  getWalletSwapActivity,
  extractDexFeatures
} from './dex_route_integration.service.js';

export type {
  SwapSegmentData,
  WalletSwapActivity
} from './dex_route_integration.service.js';
