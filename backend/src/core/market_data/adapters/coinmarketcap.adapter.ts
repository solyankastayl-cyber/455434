/**
 * CoinMarketCap Market Adapter (P2.1)
 * 
 * Protocol adapter for CoinMarketCap API.
 * Provides market cap, circulating supply, rank - context data.
 * 
 * Features:
 * - Requires API key (free tier available)
 * - Used as fallback/context, not primary candles
 * - Symbol → ID mapping
 * 
 * Endpoint: /v1/cryptocurrency/quotes/latest
 */

import {
  FetchCandlesRequest,
  FetchCandlesResponse,
} from './types.js';
import { IMarketCandle, CandleInterval } from '../storage/market_candle.model.js';
import { IMarketApiSourceDocument } from '../storage/market_api_source.model.js';
import { marketRequestExecutor } from '../sources/market_request_executor.js';
import { marketSourcePool } from '../sources/market_source_pool.js';

// ============================================
// Constants
// ============================================

const CMC_API_BASE = 'https://pro-api.coinmarketcap.com';
const CMC_QUOTES_ENDPOINT = '/v1/cryptocurrency/quotes/latest';

// Symbol to CMC ID mapping (common tokens)
export const SYMBOL_TO_CMC_ID: Record<string, number> = {
  'BTC': 1,
  'ETH': 1027,
  'BNB': 1839,
  'SOL': 5426,
  'ARB': 11841,
  'OP': 11840,
  'MATIC': 3890,
  'AVAX': 5805,
  'LINK': 1975,
  'UNI': 7083,
  'AAVE': 7278,
  'LDO': 8000,
  'PEPE': 24478,
  'SHIB': 5994,
  'DOGE': 74,
  'USDT': 825,
  'USDC': 3408,
  'DAI': 4943,
  'WBTC': 3717,
  'MKR': 1518,
  'CRV': 6538,
};

// ============================================
// Types
// ============================================

export interface CMCQuoteData {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  cmc_rank: number;
  circulating_supply: number;
  total_supply: number;
  max_supply: number | null;
  quote: {
    USD: {
      price: number;
      volume_24h: number;
      volume_change_24h: number;
      percent_change_1h: number;
      percent_change_24h: number;
      percent_change_7d: number;
      market_cap: number;
      market_cap_dominance: number;
      fully_diluted_market_cap: number;
      last_updated: string;
    };
  };
  last_updated: string;
}

export interface CMCQuotesResponse {
  data: Record<string, CMCQuoteData>;
  status: {
    timestamp: string;
    error_code: number;
    error_message: string | null;
    credit_count: number;
  };
}

export interface CMCMarketContext {
  symbol: string;
  cmcId: number;
  rank: number;
  price: number;
  volume24h: number;
  volumeChange24h: number;
  percentChange1h: number;
  percentChange24h: number;
  percentChange7d: number;
  marketCap: number;
  marketCapDominance: number;
  circulatingSupply: number;
  totalSupply: number;
  maxSupply: number | null;
  lastUpdated: Date;
}

// ============================================
// Protocol Adapter
// ============================================

export class CoinMarketCapProtocolAdapter {
  
  /**
   * Fetch market context for symbols
   * Returns market cap, rank, supply, etc.
   */
  async fetchMarketContext(symbols: string[]): Promise<CMCMarketContext[]> {
    // Filter to supported symbols
    const supportedSymbols = symbols.filter(s => SYMBOL_TO_CMC_ID[s.toUpperCase()]);
    if (supportedSymbols.length === 0) {
      return [];
    }
    
    // Get CMC IDs
    const cmcIds = supportedSymbols.map(s => SYMBOL_TO_CMC_ID[s.toUpperCase()]);
    
    // Execute via Source Pool + Executor
    const result = await marketRequestExecutor.execute<CMCQuotesResponse>(
      'coinmarketcap',
      async (source) => this.fetchQuotesFromSource(source, cmcIds)
    );
    
    if (!result.ok || !result.data) {
      throw new Error(result.error || 'Failed to fetch market context from CMC');
    }
    
    // Parse response
    return this.parseQuotes(result.data);
  }
  
  /**
   * Fetch candles - CMC doesn't provide OHLC, return empty
   * This adapter is for context only
   */
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    // CMC doesn't provide candle data in free tier
    // Return empty with note
    return {
      candles: [],
      source: 'coinmarketcap',
      rateLimit: {
        remaining: -1,
        resetAt: new Date()
      },
      metadata: {
        note: 'CMC adapter provides market context, not candles'
      }
    };
  }
  
  /**
   * Get supported symbols
   */
  getSupportedSymbols(): string[] {
    return Object.keys(SYMBOL_TO_CMC_ID);
  }
  
  /**
   * Check if any CMC source is available (requires API key)
   */
  async isAvailable(): Promise<boolean> {
    try {
      const stats = await marketSourcePool.getStats('coinmarketcap');
      return stats.activeSources > 0;
    } catch {
      return false;
    }
  }
  
  // ============================================
  // Internal: Request Building
  // ============================================
  
  /**
   * Execute quotes request against a specific source
   */
  private async fetchQuotesFromSource(
    source: IMarketApiSourceDocument,
    cmcIds: number[]
  ): Promise<CMCQuotesResponse> {
    if (!source.apiKey) {
      throw new Error('CMC adapter requires API key');
    }
    
    // Build URL with query params
    const url = new URL(CMC_API_BASE + CMC_QUOTES_ENDPOINT);
    url.searchParams.set('id', cmcIds.join(','));
    url.searchParams.set('convert', 'USD');
    
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-CMC_PRO_API_KEY': source.apiKey
      },
      signal: AbortSignal.timeout(10000)
    });
    
    if (!response.ok) {
      const error: any = new Error(`CMC HTTP ${response.status}`);
      error.status = response.status;
      
      try {
        const body = await response.json();
        error.message = `CMC: ${body.status?.error_message || response.statusText}`;
      } catch {}
      
      throw error;
    }
    
    return await response.json() as CMCQuotesResponse;
  }
  
  // ============================================
  // Internal: Response Parsing
  // ============================================
  
  /**
   * Parse CMC quotes response to market context
   */
  private parseQuotes(response: CMCQuotesResponse): CMCMarketContext[] {
    const contexts: CMCMarketContext[] = [];
    
    for (const [id, data] of Object.entries(response.data)) {
      const quote = data.quote.USD;
      
      contexts.push({
        symbol: data.symbol,
        cmcId: data.id,
        rank: data.cmc_rank,
        price: quote.price,
        volume24h: quote.volume_24h,
        volumeChange24h: quote.volume_change_24h,
        percentChange1h: quote.percent_change_1h,
        percentChange24h: quote.percent_change_24h,
        percentChange7d: quote.percent_change_7d,
        marketCap: quote.market_cap,
        marketCapDominance: quote.market_cap_dominance,
        circulatingSupply: data.circulating_supply,
        totalSupply: data.total_supply,
        maxSupply: data.max_supply,
        lastUpdated: new Date(data.last_updated)
      });
    }
    
    return contexts;
  }
}

// Singleton instance
export const coinMarketCapProtocolAdapter = new CoinMarketCapProtocolAdapter();

// ============================================
// MarketAdapter Interface Export
// ============================================

export const coinMarketCapAdapter = {
  source: 'coinmarketcap' as const,
  
  async fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse> {
    return coinMarketCapProtocolAdapter.fetchCandles(request);
  },
  
  async getSupportedSymbols(): Promise<string[]> {
    return coinMarketCapProtocolAdapter.getSupportedSymbols();
  },
  
  async isAvailable(): Promise<boolean> {
    return coinMarketCapProtocolAdapter.isAvailable();
  },
  
  getRateLimitStatus() {
    return {
      remaining: -1,
      resetAt: new Date()
    };
  },
  
  // Extra: Market context method
  async fetchMarketContext(symbols: string[]): Promise<CMCMarketContext[]> {
    return coinMarketCapProtocolAdapter.fetchMarketContext(symbols);
  }
};
