/**
 * Market Aggregation Index (P1.5)
 */

export {
  buildMetrics,
  buildAllMetrics
} from './market_metrics_builder.service.js';

export type { MetricsBuildResult } from './market_metrics_builder.service.js';

export {
  getMarketContext,
  getMultipleMarketContext,
  getMarketRegimeSummary,
  refreshMetrics
} from './market_context_aggregator.service.js';

export type { MarketContext } from './market_context_aggregator.service.js';
