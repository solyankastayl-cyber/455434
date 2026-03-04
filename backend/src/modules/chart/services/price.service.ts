/**
 * PRICE SERVICE — Real price data from exchanges
 * ===============================================
 * 
 * Uses registered exchange providers with proxy support.
 * Priority: Providers (Bybit/Binance with proxy) > Mock
 */

import type { PricePoint, PriceChartData, ChartRange, ChartTimeframe } from '../contracts/chart.types.js';
import { resolveProviderForSymbol } from '../../exchange/providers/provider.selector.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const RANGE_MS: Record<ChartRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

const TF_MAP: Record<ChartTimeframe, string> = {
  '5m': '5m',
  '15m': '15m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

// ═══════════════════════════════════════════════════════════════
// PRICE FETCHING VIA PROVIDERS
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch candles using registered providers (with proxy support)
 */
export async function fetchPriceViaProviders(
  symbol: string,
  range: ChartRange,
  tf: ChartTimeframe = '1h'
): Promise<{ points: PricePoint[]; source: string }> {
  const rangeMs = RANGE_MS[range];
  const tfMs: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  
  const limit = Math.min(200, Math.ceil(rangeMs / tfMs[tf]));
  const end = Date.now();
  const start = end - rangeMs;
  
  try {
    // Use provider selector to get best available provider
    const provider = await resolveProviderForSymbol(symbol);
    
    if (!provider) {
      console.log('[PriceService] No provider available for', symbol);
      return { points: [], source: 'none' };
    }
    
    const providerId = provider.id || 'unknown';
    
    console.log(`[PriceService] Using provider ${providerId} for ${symbol}`);
    
    // Fetch candles
    const candles = await provider.getCandles(symbol as any, TF_MAP[tf], limit, start, end);
    
    if (!candles || candles.length === 0) {
      console.log(`[PriceService] No candles from ${providerId}`);
      return { points: [], source: providerId };
    }
    
    // Map candle format (providers return {t, o, h, l, c, v})
    const points: PricePoint[] = candles.map(c => ({
      ts: c.t || c.openTime,
      price: c.c || c.close,
      volume: c.v || c.volume,
    }));
    
    console.log(`[PriceService] Got ${points.length} candles from ${providerId}, price: ${points[points.length-1]?.price}`);
    
    return { points, source: providerId };
  } catch (error: any) {
    console.error('[PriceService] Provider fetch error:', error.message);
    return { points: [], source: 'error' };
  }
}

/**
 * Get current price via providers
 */
export async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const provider = await resolveProviderForSymbol(symbol);
    
    if (!provider) return null;
    
    // Try to get ticker price first (faster)
    if (provider.getTicker) {
      const ticker = await provider.getTicker(symbol as any);
      if (ticker?.lastPrice) {
        return ticker.lastPrice;
      }
    }
    
    // Fallback to recent candle
    const candles = await provider.getCandles(symbol as any, '1m', 1);
    
    if (candles && candles.length > 0) {
      return candles[0].close;
    }
    
    return null;
  } catch (error: any) {
    console.error('[PriceService] getCurrentPrice error:', error.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MOCK PRICE GENERATOR (fallback only)
// ═══════════════════════════════════════════════════════════════

export function generateMockPrice(
  basePrice: number,
  range: ChartRange,
  tf: ChartTimeframe = '1h'
): PricePoint[] {
  const rangeMs = RANGE_MS[range];
  const tfMs: Record<string, number> = {
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  
  const interval = tfMs[tf];
  const points: PricePoint[] = [];
  const now = Date.now();
  const start = now - rangeMs;
  
  let price = basePrice;
  
  for (let ts = start; ts <= now; ts += interval) {
    // Random walk with mean reversion
    const change = (Math.random() - 0.5) * 0.02 * price;
    const reversion = (basePrice - price) * 0.01;
    price += change + reversion;
    
    points.push({
      ts,
      price: Math.round(price * 100) / 100,
      volume: Math.random() * 1000000,
    });
  }
  
  return points;
}

// ═══════════════════════════════════════════════════════════════
// MAIN API
// ═══════════════════════════════════════════════════════════════

/**
 * Get price chart data
 * Priority: Providers (with proxy) → Mock fallback
 */
export async function getPriceChartData(
  symbol: string,
  range: ChartRange,
  tf: ChartTimeframe = '1h',
  source: string = 'auto'
): Promise<PriceChartData> {
  let points: PricePoint[] = [];
  let actualSource = 'mock';
  
  // Try providers first
  const providerResult = await fetchPriceViaProviders(symbol, range, tf);
  
  if (providerResult.points.length > 0) {
    points = providerResult.points;
    actualSource = providerResult.source;
  }
  
  // Fallback to mock if providers failed
  if (points.length === 0) {
    console.warn(`[PriceService] All providers failed for ${symbol}, using mock`);
    
    // Try to get at least current price for realistic mock
    const currentPrice = await getCurrentPrice(symbol);
    const basePrices: Record<string, number> = {
      'BTCUSDT': currentPrice || 69000,
      'ETHUSDT': 2500,
      'SOLUSDT': 120,
    };
    
    points = generateMockPrice(basePrices[symbol] || 100, range, tf);
    actualSource = 'mock';
  }
  
  const firstPrice = points[0]?.price || 0;
  const lastPrice = points[points.length - 1]?.price || 0;
  const priceChange = lastPrice - firstPrice;
  const priceChangePercent = firstPrice > 0 ? (priceChange / firstPrice) * 100 : 0;
  
  return {
    symbol,
    source: actualSource,
    range,
    tf,
    points,
    meta: {
      start: points[0]?.ts || Date.now(),
      end: points[points.length - 1]?.ts || Date.now(),
      count: points.length,
      lastPrice,
      priceChange,
      priceChangePercent,
    },
  };
}

console.log('[PriceService] Loaded with provider support');
