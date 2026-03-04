/**
 * Market Adapter Types (P1.5)
 */

import { CandleInterval, IMarketCandle, MarketSource } from '../storage/market_candle.model.js';

// ============================================
// Types
// ============================================

export interface FetchCandlesRequest {
  symbol: string;
  interval: CandleInterval;
  fromTs?: number;
  toTs?: number;
  limit?: number;
}

export interface FetchCandlesResponse {
  candles: IMarketCandle[];
  source: MarketSource;
  rateLimit?: {
    remaining: number;
    resetAt: Date;
  };
}

export interface MarketAdapter {
  source: MarketSource;
  
  /**
   * Fetch OHLCV candles
   */
  fetchCandles(request: FetchCandlesRequest): Promise<FetchCandlesResponse>;
  
  /**
   * Get supported symbols
   */
  getSupportedSymbols(): Promise<string[]>;
  
  /**
   * Check if adapter is available
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * Get rate limit status
   */
  getRateLimitStatus(): { remaining: number; resetAt: Date } | null;
}

// ============================================
// Symbol Mapping
// ============================================

// Map internal symbols to CoinGecko IDs
export const SYMBOL_TO_COINGECKO: Record<string, string> = {
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'ARB': 'arbitrum',
  'OP': 'optimism',
  'MATIC': 'matic-network',
  'POL': 'matic-network',
  'AVAX': 'avalanche-2',
  'BNB': 'binancecoin',
  'SOL': 'solana',
  'USDT': 'tether',
  'USDC': 'usd-coin',
  'DAI': 'dai',
  'LINK': 'chainlink',
  'UNI': 'uniswap',
  'AAVE': 'aave',
  'CRV': 'curve-dao-token',
  'MKR': 'maker',
  'LDO': 'lido-dao',
  'PEPE': 'pepe',
  'SHIB': 'shiba-inu',
  'DOGE': 'dogecoin',
  'WBTC': 'wrapped-bitcoin',
  'WETH': 'weth',
  'BASE': 'base', // Placeholder - not tradeable
  'ZKSYNC': 'zksync', // Placeholder
};

// Map internal symbols to Binance pairs
export const SYMBOL_TO_BINANCE: Record<string, string> = {
  'ETH': 'ETHUSDT',
  'BTC': 'BTCUSDT',
  'ARB': 'ARBUSDT',
  'OP': 'OPUSDT',
  'MATIC': 'MATICUSDT',
  'AVAX': 'AVAXUSDT',
  'BNB': 'BNBUSDT',
  'SOL': 'SOLUSDT',
  'LINK': 'LINKUSDT',
  'UNI': 'UNIUSDT',
  'AAVE': 'AAVEUSDT',
  'LDO': 'LDOUSDT',
  'PEPE': 'PEPEUSDT',
  'SHIB': 'SHIBUSDT',
  'DOGE': 'DOGEUSDT'
};

// Default symbols to track
export const DEFAULT_MARKET_SYMBOLS = [
  'ETH', 'BTC', 'ARB', 'OP', 'MATIC', 'AVAX', 'BNB', 
  'LINK', 'UNI', 'AAVE', 'LDO'
];

// ============================================
// Interval Mapping
// ============================================

export const INTERVAL_TO_MS: Record<CandleInterval, number> = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000
};

export const INTERVAL_TO_COINGECKO_DAYS: Record<CandleInterval, number> = {
  '1m': 1,   // Max 1 day for minute candles
  '5m': 1,
  '1h': 90,
  '4h': 90,
  '1d': 365
};
