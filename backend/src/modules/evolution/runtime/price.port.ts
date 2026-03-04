/**
 * PRICE PORT
 * 
 * Port for getting historical prices
 */

export interface PricePort {
  // Return close price at or near tsIso
  getPriceAt(symbol: string, tsIso: string): Promise<number>;
  // Optional: compute max drawdown within [start,end]
  getMaxDrawdown?(symbol: string, startIso: string, endIso: string, action: "BUY" | "SELL"): Promise<number>;
}

console.log('[Evolution] Price port loaded');
