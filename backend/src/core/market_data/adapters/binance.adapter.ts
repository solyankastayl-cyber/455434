/**
 * Binance Market Adapter (P2.1)
 * 
 * Protocol adapter for Binance public Klines API.
 * Uses MarketRequestExecutor + Source Pool for all requests.
 * 
 * Features:
 * - Public endpoint (no API key required)
 * - 1m, 5m, 1h intervals
 * - Rate-limit aware via Source Pool
 * 
 * Endpoint: GET /api/v3/klines (public, 1200 RPM limit)
 */

import {
  FetchCandlesRequest,
  FetchCandlesResponse,
  SYMBOL_TO_BINANCE,
  INTERVAL_TO_MS,
} from './types.js';
import { IMarketCandle, CandleInterval } from '../storage/market_candle.model.js';
import { IMarketApiSourceDocument } from '../storage/market_api_source.model.js';
import { marketRequestExecutor } from '../sources/market_request_executor.js';
import { marketSourcePool } from '../sources/market_source_pool.js';

// ============================================
// Constants
// ============================================

const BINANCE_API_BASE = 'https://api.binance.com';
const BINANCE_API_KLINES = '/api/v3/klines';

// Max candles per request (Binance limit is 1000)
const MAX_CANDLES_PER_REQUEST = 500;

// Max lookback per interval
const MAX_LOOKBACK_MS: Record<CandleInterval, number> = {
  '1m': 24 * 60 * 60 * 1000,        // 24 hours
  '5m': 3 * 24 * 60 * 60 * 1000,    // 3 days
  '1h': 30 * 24 * 60 * 60 * 1000,   // 30 days
  '4h': 90 * 24 * 60 * 60 * 1000,   // 90 days
  '1d': 365 * 24 * 60 * 60 * 1000,  // 1 year
};

// Binance interval format
const INTERVAL_TO_BINANCE: Record<CandleInterval, string> = {
  '1m': '1m',
  '5m': '5m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

// ============================================
// Types
// ============================================

interface BinanceKlineResponse {
  data: BinanceKline[];
  sourceId: string;
  latencyMs: number;
}

// Binance returns arrays: [openTime, open, high, low, close, volume, closeTime, ...]
type BinanceKline = [
  number,   // 0: Open time
  string,   // 1: Open
  string,   // 2: High
  string,   // 3: Low
  string,   // 4: Close
  string,   // 5: Volume
  number,   // 6: Close time
  string,   // 7: Quote asset volume
  number,   // 8: Number of trades
  string,   // 9: Taker buy base asset volume
  string,   // 10: Taker buy quote asset volume
  string    // 11: Ignore
];

// ============================================
// Protocol Adapter
// ============================================

export class BinanceProtocolAdapter {
  
  /**
   * Fetch OHLCV candles using Source Pool
   */
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    const { symbol, interval, limit } = request;
    
    // Map symbol to Binance pair
    const pair = SYMBOL_TO_BINANCE[symbol.toUpperCase()];
    if (!pair) {
      throw new Error(`Symbol ${symbol} not supported by Binance adapter`);
    }
    
    // Calculate time range
    const now = Date.now();
    const maxLookback = MAX_LOOKBACK_MS[interval];
    const fromTs = request.fromTs || (now - maxLookback);
    const toTs = request.toTs || now;
    
    // Guard: max lookback
    const actualFromTs = Math.max(fromTs, now - maxLookback);
    
    // Guard: max candles
    const candleLimit = Math.min(limit || MAX_CANDLES_PER_REQUEST, MAX_CANDLES_PER_REQUEST);
    
    // Execute via Source Pool + Executor
    const result = await marketRequestExecutor.execute<BinanceKlineResponse>(
      'binance',
      async (source) => {
        const data = await this.fetchKlinesFromSource(
          source, 
          pair, 
          interval, 
          actualFromTs, 
          toTs, 
          candleLimit
        );
        return {
          data,
          sourceId: source._id.toString(),
          latencyMs: 0
        };
      }
    );
    
    if (!result.ok || !result.data) {
      throw new Error(result.error || 'Failed to fetch candles from Binance');
    }
    
    // Parse raw klines
    const candles = this.parseKlines(result.data.data, symbol, interval, actualFromTs, toTs);
    
    return {
      candles,
      source: 'binance',
      rateLimit: {
        remaining: -1, // Managed by pool
        resetAt: new Date()
      },
      metadata: {
        sourceId: result.sourceId,
        latencyMs: result.latencyMs,
        attempts: result.attempts
      }
    };
  }
  
  /**
   * Get supported symbols
   */
  getSupportedSymbols(): string[] {
    return Object.keys(SYMBOL_TO_BINANCE);
  }
  
  /**
   * Check if any Binance source is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const stats = await marketSourcePool.getStats('binance');
      return stats.activeSources > 0;
    } catch {
      return false;
    }
  }
  
  // ============================================
  // Internal: Request Building
  // ============================================
  
  /**
   * Execute klines request against a specific source
   */
  private async fetchKlinesFromSource(
    source: IMarketApiSourceDocument,
    pair: string,
    interval: CandleInterval,
    startTime: number,
    endTime: number,
    limit: number
  ): Promise<BinanceKline[]> {
    const binanceInterval = INTERVAL_TO_BINANCE[interval];
    
    // Build URL with query params
    const url = new URL(BINANCE_API_BASE + BINANCE_API_KLINES);
    url.searchParams.set('symbol', pair);
    url.searchParams.set('interval', binanceInterval);
    url.searchParams.set('startTime', startTime.toString());
    url.searchParams.set('endTime', endTime.toString());
    url.searchParams.set('limit', limit.toString());
    
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    
    // Add API key header if available (increases rate limits)
    if (source.apiKey) {
      headers['X-MBX-APIKEY'] = source.apiKey;
    }
    
    const response = await fetch(url.toString(), { 
      headers,
      signal: AbortSignal.timeout(10000) // 10s timeout
    });
    
    if (!response.ok) {
      const error: any = new Error(`Binance HTTP ${response.status}`);
      error.status = response.status;
      
      // Parse error message if available
      try {
        const body = await response.json();
        error.message = `Binance: ${body.msg || response.statusText}`;
        error.code = body.code;
      } catch {}
      
      throw error;
    }
    
    return await response.json() as BinanceKline[];
  }
  
  // ============================================
  // Internal: Response Parsing
  // ============================================
  
  /**
   * Parse Binance klines response to standard format
   */
  private parseKlines(
    data: BinanceKline[],
    symbol: string,
    interval: CandleInterval,
    fromTs?: number,
    toTs?: number
  ): IMarketCandle[] {
    // Binance returns: [openTime, open, high, low, close, volume, closeTime, ...]
    let candles: IMarketCandle[] = data.map(kline => ({
      source: 'binance' as const,
      symbol: symbol.toUpperCase(),
      interval,
      ts: kline[0],                      // Open time
      o: parseFloat(kline[1]),           // Open
      h: parseFloat(kline[2]),           // High
      l: parseFloat(kline[3]),           // Low
      c: parseFloat(kline[4]),           // Close
      v: parseFloat(kline[5]),           // Volume (base asset)
      quoteVolume: parseFloat(kline[7]), // Quote asset volume
      trades: kline[8],                  // Number of trades
      createdAt: new Date()
    }));
    
    // Filter by time range (defensive, API should handle this)
    if (fromTs) {
      candles = candles.filter(c => c.ts >= fromTs);
    }
    if (toTs) {
      candles = candles.filter(c => c.ts <= toTs);
    }
    
    return candles;
  }
}

// Singleton instance
export const binanceProtocolAdapter = new BinanceProtocolAdapter();

// ============================================
// MarketAdapter Interface Export
// ============================================

export const binanceAdapter = {
  source: 'binance' as const,
  
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    return binanceProtocolAdapter.fetchCandles(request);
  },
  
  async getSupportedSymbols(): Promise<string[]> {
    return binanceProtocolAdapter.getSupportedSymbols();
  },
  
  async isAvailable(): Promise<boolean> {
    return binanceProtocolAdapter.isAvailable();
  },
  
  getRateLimitStatus() {
    return {
      remaining: -1, // Managed by pool
      resetAt: new Date()
    };
  }
};
