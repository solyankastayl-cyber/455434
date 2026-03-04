/**
 * Phase H: Market Provider Interface
 */

export interface Candle {
  ts: number;  // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v?: number;
}

export interface MarketProvider {
  getCandles(params: {
    asset: string;
    timeframe: string;
    fromTs: number;
    limit: number;
  }): Promise<Candle[]>;
}
