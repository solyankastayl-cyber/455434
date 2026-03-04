/**
 * Market Context Aggregator (P1.5)
 * 
 * Provides unified market context for API consumers.
 */

import {
  getLatestCandle,
  getCandles,
  CandleInterval
} from '../storage/market_candle.model.js';
import {
  getLatestMetric,
  getMetricsHistory,
  MarketRegime,
  MetricWindow
} from '../storage/market_metric.model.js';
import { getQuality } from '../storage/market_quality.model.js';
import { buildMetrics } from './market_metrics_builder.service.js';

// ============================================
// Types
// ============================================

export interface MarketContext {
  symbol: string;
  timestamp: Date;
  
  // Current price
  price: number;
  priceChange24h: number;
  priceChange24hPct: number;
  
  // Regime
  regime: MarketRegime;
  regimeScore: number;
  
  // Volatility
  volatility24h: number;
  volatility7d: number;
  
  // Volume
  volumeZ24h: number;
  volumeTotal24h: number;
  
  // Quality
  dataQuality: {
    score: number;
    coverage: number;
    freshnessMin: number;
  };
}

// ============================================
// Context Aggregator
// ============================================

/**
 * Get full market context for a symbol
 */
export async function getMarketContext(symbol: string): Promise<MarketContext | null> {
  const normalizedSymbol = symbol.toUpperCase();
  
  // Get latest candle
  const latestCandle = await getLatestCandle(normalizedSymbol, '1h');
  if (!latestCandle) {
    return null;
  }
  
  // Get metrics for different windows
  const [metric24h, metric7d] = await Promise.all([
    getLatestMetric(normalizedSymbol, '24h'),
    getLatestMetric(normalizedSymbol, '7d')
  ]);
  
  // Get quality info
  const quality = await getQuality(normalizedSymbol, '1h');
  
  // Calculate freshness
  const now = Date.now();
  const freshnessMin = Math.round((now - latestCandle.ts) / 60000);
  
  return {
    symbol: normalizedSymbol,
    timestamp: new Date(),
    
    price: latestCandle.c,
    priceChange24h: metric24h?.priceClose && metric24h?.priceOpen 
      ? metric24h.priceClose - metric24h.priceOpen 
      : 0,
    priceChange24hPct: metric24h?.priceChangePct || 0,
    
    regime: metric24h?.regime || 'CALM',
    regimeScore: metric24h?.regimeScore || 0,
    
    volatility24h: metric24h?.volatilityPct || 0,
    volatility7d: metric7d?.volatilityPct || 0,
    
    volumeZ24h: metric24h?.volumeZ || 0,
    volumeTotal24h: metric24h?.volumeTotal || 0,
    
    dataQuality: {
      score: quality?.qualityScore || 0,
      coverage: quality?.coveragePct24h || 0,
      freshnessMin
    }
  };
}

/**
 * Get market context for multiple symbols
 */
export async function getMultipleMarketContext(
  symbols: string[]
): Promise<Map<string, MarketContext | null>> {
  const results = new Map<string, MarketContext | null>();
  
  await Promise.all(
    symbols.map(async symbol => {
      const context = await getMarketContext(symbol);
      results.set(symbol.toUpperCase(), context);
    })
  );
  
  return results;
}

/**
 * Get market regime summary
 */
export async function getMarketRegimeSummary(
  symbols: string[]
): Promise<{
  calm: number;
  volatile: number;
  stressed: number;
  unknown: number;
  avgRegimeScore: number;
}> {
  const summary = {
    calm: 0,
    volatile: 0,
    stressed: 0,
    unknown: 0,
    avgRegimeScore: 0
  };
  
  let totalScore = 0;
  let count = 0;
  
  for (const symbol of symbols) {
    const metric = await getLatestMetric(symbol.toUpperCase(), '24h');
    
    if (!metric) {
      summary.unknown++;
      continue;
    }
    
    switch (metric.regime) {
      case 'CALM':
        summary.calm++;
        break;
      case 'VOLATILE':
        summary.volatile++;
        break;
      case 'STRESSED':
        summary.stressed++;
        break;
    }
    
    totalScore += metric.regimeScore;
    count++;
  }
  
  summary.avgRegimeScore = count > 0 ? Math.round(totalScore / count) : 0;
  
  return summary;
}

/**
 * Refresh metrics for a symbol (rebuild from candles)
 */
export async function refreshMetrics(
  symbol: string,
  interval: CandleInterval = '1h'
): Promise<void> {
  const windows: MetricWindow[] = ['1h', '24h', '7d'];
  
  for (const window of windows) {
    await buildMetrics(symbol, window, interval);
  }
}
