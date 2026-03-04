/**
 * Market Data Storage Index (P1.5)
 */

export {
  MarketCandleModel,
  upsertCandles,
  getCandles,
  getLatestCandle,
  getCandleCount,
  getAvailableSymbols
} from './market_candle.model.js';

export type {
  MarketSource,
  CandleInterval,
  IMarketCandle
} from './market_candle.model.js';

export {
  MarketMetricModel,
  upsertMetric,
  getLatestMetric,
  getMetricsHistory,
  getRegimeDistribution
} from './market_metric.model.js';

export type {
  MetricWindow,
  MarketRegime,
  IMarketMetric
} from './market_metric.model.js';

export {
  MarketSourceStateModel,
  getOrCreateSourceState,
  updateSyncProgress,
  recordSyncError,
  updateRateLimit,
  pauseSource,
  resumeSource,
  getAllSourceStates,
  getSourceHealthSummary
} from './market_source_state.model.js';

export type {
  SourceStatus,
  IRateLimitState,
  IMarketSourceState
} from './market_source_state.model.js';

export {
  MarketQualityModel,
  upsertQuality,
  getQuality,
  getAllQuality,
  getQualitySummary
} from './market_quality.model.js';

export type { IMarketQuality } from './market_quality.model.js';
