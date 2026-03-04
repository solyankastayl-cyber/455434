/**
 * CoinGecko Market Adapter v2 (P1.5.C)
 * 
 * Protocol adapter - does NOT make HTTP calls directly.
 * Uses MarketRequestExecutor + Source Pool for all requests.
 * 
 * Responsibilities:
 * - Build request URLs/params
 * - Parse responses
 * - Normalize data format
 */

import {
  FetchCandlesRequest,
  FetchCandlesResponse,
  SYMBOL_TO_COINGECKO,
  INTERVAL_TO_COINGECKO_DAYS,
} from './types.js';
import { IMarketCandle, CandleInterval } from '../storage/market_candle.model.js';
import { IMarketApiSourceDocument } from '../storage/market_api_source.model.js';
import { marketRequestExecutor } from '../sources/market_request_executor.js';
import { marketSourcePool } from '../sources/market_source_pool.js';

// ============================================
// Types
// ============================================

export type CoinGeckoCapability = 'candles' | 'price' | 'volume' | 'market_context';

interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

interface CoinGeckoOHLCResponse {
  data: number[][];
  sourceId: string;
  latencyMs: number;
}

interface CoinGeckoMarketChartResponse {
  prices?: number[][];
  total_volumes?: number[][];
}

// ============================================
// Protocol Adapter (No HTTP)
// ============================================

export class CoinGeckoProtocolAdapter {
  
  /**
   * Fetch OHLC candles using Source Pool
   */
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    const { symbol, interval, fromTs, toTs } = request;
    
    // Map symbol to CoinGecko ID
    const coinId = SYMBOL_TO_COINGECKO[symbol.toUpperCase()];
    if (!coinId) {
      throw new Error(`Symbol ${symbol} not supported by CoinGecko adapter`);
    }
    
    const days = INTERVAL_TO_COINGECKO_DAYS[interval];
    
    // Execute via Source Pool + Executor
    const result = await marketRequestExecutor.execute<CoinGeckoOHLCResponse>(
      'coingecko',
      async (source) => {
        const data = await this.fetchOHLCFromSource(source, coinId, days);
        return {
          data,
          sourceId: source._id.toString(),
          latencyMs: 0
        };
      }
    );
    
    if (!result.ok || !result.data) {
      throw new Error(result.error || 'Failed to fetch candles');
    }
    
    // Parse raw OHLC data
    const candles = this.parseOHLC(result.data.data, symbol, interval, fromTs, toTs);
    
    // Try to enrich with volume (optional, don't fail if unavailable)
    await this.enrichWithVolume(candles, coinId, days);
    
    return {
      candles,
      source: 'coingecko',
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
    return Object.keys(SYMBOL_TO_COINGECKO);
  }
  
  /**
   * Check if any CoinGecko source is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      const stats = await marketSourcePool.getStats('coingecko');
      return stats.activeSources > 0;
    } catch {
      return false;
    }
  }
  
  // ============================================
  // Internal: Request Building
  // ============================================
  
  /**
   * Execute OHLC request against a specific source
   */
  private async fetchOHLCFromSource(
    source: IMarketApiSourceDocument,
    coinId: string,
    days: number
  ): Promise<number[][]> {
    const baseUrl = source.apiKey
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    const url = `${baseUrl}/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    
    if (source.apiKey) {
      headers['x-cg-pro-api-key'] = source.apiKey;
    }
    
    const response = await fetch(url, { 
      headers,
      signal: AbortSignal.timeout(12000)
    });
    
    if (!response.ok) {
      const error: any = new Error(`CoinGecko HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    
    return await response.json() as number[][];
  }
  
  /**
   * Execute market_chart request for volume data
   */
  private async fetchMarketChartFromSource(
    source: IMarketApiSourceDocument,
    coinId: string,
    days: number
  ): Promise<CoinGeckoMarketChartResponse> {
    const baseUrl = source.apiKey
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    const url = `${baseUrl}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;
    
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    };
    
    if (source.apiKey) {
      headers['x-cg-pro-api-key'] = source.apiKey;
    }
    
    const response = await fetch(url, { 
      headers,
      signal: AbortSignal.timeout(12000)
    });
    
    if (!response.ok) {
      const error: any = new Error(`CoinGecko HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    
    return await response.json() as CoinGeckoMarketChartResponse;
  }
  
  // ============================================
  // Internal: Response Parsing
  // ============================================
  
  /**
   * Parse CoinGecko OHLC response to standard format
   */
  private parseOHLC(
    data: number[][],
    symbol: string,
    interval: CandleInterval,
    fromTs?: number,
    toTs?: number
  ): IMarketCandle[] {
    // CoinGecko returns: [timestamp, open, high, low, close]
    let candles: IMarketCandle[] = data.map(row => ({
      source: 'coingecko' as const,
      symbol: symbol.toUpperCase(),
      interval,
      ts: row[0],
      o: row[1],
      h: row[2],
      l: row[3],
      c: row[4],
      v: 0, // Volume added later
      createdAt: new Date()
    }));
    
    // Filter by time range
    if (fromTs) {
      candles = candles.filter(c => c.ts >= fromTs);
    }
    if (toTs) {
      candles = candles.filter(c => c.ts <= toTs);
    }
    
    return candles;
  }
  
  /**
   * Enrich candles with volume from market_chart endpoint
   */
  private async enrichWithVolume(
    candles: IMarketCandle[],
    coinId: string,
    days: number
  ): Promise<void> {
    if (candles.length === 0) return;
    
    try {
      const result = await marketRequestExecutor.execute<CoinGeckoMarketChartResponse>(
        'coingecko',
        async (source) => this.fetchMarketChartFromSource(source, coinId, days)
      );
      
      if (!result.ok || !result.data?.total_volumes) return;
      
      // Create volume lookup map (rounded to hour)
      const volumeMap = new Map<number, number>();
      for (const [ts, vol] of result.data.total_volumes) {
        const roundedTs = Math.floor(ts / 3600000) * 3600000;
        volumeMap.set(roundedTs, vol);
      }
      
      // Enrich candles
      for (const candle of candles) {
        const roundedTs = Math.floor(candle.ts / 3600000) * 3600000;
        const volume = volumeMap.get(roundedTs);
        if (volume !== undefined) {
          candle.v = volume;
        }
      }
    } catch {
      // Volume enrichment is optional
    }
  }
}

// Singleton instance
export const coingeckoProtocolAdapter = new CoinGeckoProtocolAdapter();

// ============================================
// Legacy Compatibility Export
// ============================================

export const coingeckoAdapter = {
  source: 'coingecko' as const,
  
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    return coingeckoProtocolAdapter.fetchCandles(request);
  },
  
  async getSupportedSymbols(): Promise<string[]> {
    return coingeckoProtocolAdapter.getSupportedSymbols();
  },
  
  async isAvailable(): Promise<boolean> {
    return coingeckoProtocolAdapter.isAvailable();
  },
  
  getRateLimitStatus() {
    return {
      remaining: -1, // Managed by pool
      resetAt: new Date()
    };
  }
};
