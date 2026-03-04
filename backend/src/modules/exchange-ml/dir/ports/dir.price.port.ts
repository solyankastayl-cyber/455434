/**
 * Direction Price Port
 * ====================
 * 
 * Abstract interface for price data access.
 * Allows Direction Model to work with any price provider.
 */

export type TF = '1h' | '4h' | '1d';

export interface PriceBar {
  t: number;        // unix sec
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/**
 * Abstract port for price data
 */
export interface DirPricePort {
  /**
   * Get price series for a symbol
   * @param params.symbol - Trading pair (e.g., 'BTCUSDT')
   * @param params.from - Start time (unix seconds)
   * @param params.to - End time (unix seconds)
   * @param params.tf - Timeframe ('1h', '4h', '1d')
   * @returns Array of price bars
   */
  getSeries(params: {
    symbol: string;
    from: number;
    to: number;
    tf: TF;
  }): Promise<PriceBar[]>;
  
  /**
   * Get latest price for a symbol
   */
  getLatestPrice(symbol: string): Promise<number | null>;
}

console.log('[Exchange ML] Direction price port loaded');
