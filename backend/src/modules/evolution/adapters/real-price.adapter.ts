/**
 * REAL PRICE ADAPTER
 * ==================
 * 
 * Connects Evolution module to the real price.service.ts
 * Single source of truth for:
 * - Chart series
 * - Outcomes (entry/exit prices)
 * - Forecast baseline (fromPrice)
 * - Evolution evaluation
 * 
 * All timestamps are in UTC ISO format.
 */

import type { PricePort } from "../runtime/price.port.js";
import { fetchPriceViaProviders, getCurrentPrice } from "../../chart/services/price.service.js";
import type { ChartRange } from "../../chart/contracts/chart.types.js";

export class RealPriceAdapter implements PricePort {
  /**
   * Get price at specific timestamp
   * 
   * Strategy:
   * 1. Determine range needed based on how old the timestamp is
   * 2. Fetch candles covering that range
   * 3. Find closest candle to target timestamp
   * 4. Return close price
   * 
   * @param symbol - e.g. "BTCUSDT"
   * @param tsIso - ISO timestamp, e.g. "2026-02-14T12:00:00.000Z"
   * @returns Close price at that time (or closest available)
   */
  async getPriceAt(symbol: string, tsIso: string): Promise<number> {
    const targetTs = new Date(tsIso).getTime();
    const now = Date.now();
    const ageMs = now - targetTs;
    
    // Determine range needed (add buffer)
    let range: ChartRange = '24h';
    if (ageMs > 7 * 24 * 60 * 60 * 1000) range = '30d';
    else if (ageMs > 24 * 60 * 60 * 1000) range = '7d';
    
    // Determine timeframe (higher res for recent, lower for old)
    const tf = ageMs < 2 * 60 * 60 * 1000 ? '5m' : 
               ageMs < 24 * 60 * 60 * 1000 ? '15m' : '1h';
    
    try {
      const result = await fetchPriceViaProviders(symbol, range, tf as any);
      
      if (!result.points || result.points.length === 0) {
        console.warn(`[RealPriceAdapter] No price data for ${symbol} at ${tsIso}, using current`);
        const current = await getCurrentPrice(symbol);
        return current || 0;
      }
      
      // Find closest candle to target timestamp
      let closestPoint = result.points[0];
      let minDiff = Math.abs(closestPoint.ts - targetTs);
      
      for (const point of result.points) {
        const diff = Math.abs(point.ts - targetTs);
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }
      
      // Warn if we're far from target (more than 2 hours)
      if (minDiff > 2 * 60 * 60 * 1000) {
        console.warn(
          `[RealPriceAdapter] Price for ${symbol} at ${tsIso} is ${Math.round(minDiff / 60000)}min away from target`
        );
      }
      
      console.log(
        `[RealPriceAdapter] getPriceAt(${symbol}, ${tsIso}) = ${closestPoint.price} ` +
        `(from ${new Date(closestPoint.ts).toISOString()}, source=${result.source})`
      );
      
      return closestPoint.price;
    } catch (error: any) {
      console.error(`[RealPriceAdapter] getPriceAt error for ${symbol}:`, error.message);
      
      // Fallback to current price
      const current = await getCurrentPrice(symbol);
      return current || 0;
    }
  }

  /**
   * Get maximum drawdown in a period
   * 
   * For BUY: max drop from any high to subsequent low
   * For SELL: max rise from any low to subsequent high
   * 
   * @param symbol - e.g. "BTCUSDT"
   * @param startIso - Start of period (entry time)
   * @param endIso - End of period (exit time)
   * @param action - BUY or SELL (affects drawdown direction)
   * @returns Max drawdown as decimal (e.g., 0.05 = 5% drawdown)
   */
  async getMaxDrawdown(
    symbol: string,
    startIso: string,
    endIso: string,
    action: "BUY" | "SELL"
  ): Promise<number> {
    const startTs = new Date(startIso).getTime();
    const endTs = new Date(endIso).getTime();
    const durationMs = endTs - startTs;
    
    // Determine range to fetch
    let range: ChartRange = '24h';
    if (durationMs > 7 * 24 * 60 * 60 * 1000) range = '30d';
    else if (durationMs > 24 * 60 * 60 * 1000) range = '7d';
    
    // Use appropriate timeframe
    const tf = durationMs < 6 * 60 * 60 * 1000 ? '5m' :
               durationMs < 48 * 60 * 60 * 1000 ? '15m' : '1h';
    
    try {
      const result = await fetchPriceViaProviders(symbol, range, tf as any);
      
      if (!result.points || result.points.length < 2) {
        console.warn(`[RealPriceAdapter] Insufficient data for drawdown calculation`);
        return 0;
      }
      
      // Filter points within the period
      const periodPoints = result.points.filter(p => p.ts >= startTs && p.ts <= endTs);
      
      if (periodPoints.length < 2) {
        console.warn(`[RealPriceAdapter] No points in period for drawdown`);
        return 0;
      }
      
      let maxDrawdown = 0;
      
      if (action === "BUY") {
        // For BUY: track max drop from peak
        let peak = periodPoints[0].price;
        
        for (const point of periodPoints) {
          if (point.price > peak) {
            peak = point.price;
          }
          const drawdown = (peak - point.price) / peak;
          if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
          }
        }
      } else {
        // For SELL: track max rise from trough (adverse for short)
        let trough = periodPoints[0].price;
        
        for (const point of periodPoints) {
          if (point.price < trough) {
            trough = point.price;
          }
          const drawup = (point.price - trough) / trough;
          if (drawup > maxDrawdown) {
            maxDrawdown = drawup;
          }
        }
      }
      
      console.log(
        `[RealPriceAdapter] getMaxDrawdown(${symbol}, ${action}) = ${(maxDrawdown * 100).toFixed(2)}% ` +
        `(${periodPoints.length} points)`
      );
      
      return maxDrawdown;
    } catch (error: any) {
      console.error(`[RealPriceAdapter] getMaxDrawdown error:`, error.message);
      return 0;
    }
  }

  /**
   * Get current price (convenience method)
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    const price = await getCurrentPrice(symbol);
    return price || 0;
  }

  /**
   * Get price history for a range
   * Returns array of {ts, price, volume} points
   */
  async getPriceHistory(
    symbol: string,
    fromTs: number,
    toTs: number
  ): Promise<Array<{ ts: number; price: number; volume?: number }>> {
    const durationMs = toTs - fromTs;
    
    let range: ChartRange = '24h';
    if (durationMs > 30 * 24 * 60 * 60 * 1000) range = '90d';
    else if (durationMs > 7 * 24 * 60 * 60 * 1000) range = '30d';
    else if (durationMs > 24 * 60 * 60 * 1000) range = '7d';
    
    const result = await fetchPriceViaProviders(symbol, range, '1h');
    
    // Filter to requested range
    return result.points.filter(p => p.ts >= fromTs && p.ts <= toTs);
  }
}

console.log('[Evolution] Real price adapter loaded');
