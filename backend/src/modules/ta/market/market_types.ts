/**
 * Phase J: Market Provider Types
 */

export interface MarketCandle {
  ts: number;       // Unix timestamp (ms)
  o: number;        // Open
  h: number;        // High
  l: number;        // Low
  c: number;        // Close
  v: number;        // Volume
}

export interface MarketProviderConfig {
  provider: 'binance' | 'mock';
  baseUrl?: string;
  timeout?: number;
  rateLimitMs?: number;
}

export interface FetchCandlesParams {
  symbol: string;
  interval: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
}

export const DEFAULT_MARKET_CONFIG: MarketProviderConfig = {
  provider: 'binance',
  baseUrl: 'https://api.binance.com',
  timeout: 10000,
  rateLimitMs: 100,
};
