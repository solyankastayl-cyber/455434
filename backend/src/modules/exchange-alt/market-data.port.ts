/**
 * MARKET DATA PORT — Interface for alt data providers
 * ====================================================
 * 
 * Единый вход для данных по альтам.
 * Сегодня: mock/proxy
 * Завтра: реальный Binance без переписывания
 */

import type {
  UniverseAsset,
  MarketOHLCV,
  DerivativesSnapshot,
  TickerSnapshot,
  Timeframe,
} from './types.js';

export interface IMarketDataPort {
  /**
   * Get list of tradeable assets
   */
  getUniverse(): Promise<UniverseAsset[]>;
  
  /**
   * Get OHLCV candles
   */
  getOHLCV(params: {
    symbol: string;
    timeframe: Timeframe;
    limit: number;
  }): Promise<MarketOHLCV[]>;
  
  /**
   * Get derivatives data (funding, OI, long/short, liquidations)
   */
  getDerivativesSnapshot(params: {
    symbol: string;
  }): Promise<DerivativesSnapshot>;
  
  /**
   * Get current ticker
   */
  getTicker(symbol: string): Promise<TickerSnapshot | null>;
  
  /**
   * Get last price
   */
  getLastPrice(symbol: string): Promise<number | null>;
  
  /**
   * Get multiple tickers at once (batch)
   */
  getTickers(symbols: string[]): Promise<TickerSnapshot[]>;
}
