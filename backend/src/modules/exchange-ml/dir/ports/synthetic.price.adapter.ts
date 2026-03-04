/**
 * Synthetic Price Provider for Direction Model Testing
 * =====================================================
 * 
 * Generates synthetic price data for backfill when real data is unavailable.
 * Uses deterministic random walk based on symbol seed.
 */

import { DirPricePort, TF, PriceBar } from './dir.price.port.js';

/**
 * Generates deterministic synthetic price bars
 */
export class SyntheticDirPriceAdapter implements DirPricePort {
  private basePrice: Record<string, number> = {
    'BTCUSDT': 50000,
    'ETHUSDT': 3000,
    'SOLUSDT': 100,
    'BNBUSDT': 400,
    'XRPUSDT': 0.5,
  };
  
  async getSeries(params: {
    symbol: string;
    from: number;
    to: number;
    tf: TF;
  }): Promise<PriceBar[]> {
    const { symbol, from, to, tf } = params;
    
    // Get base price for symbol
    let base = this.basePrice[symbol.toUpperCase()] || 1000;
    
    // Timeframe in seconds
    const tfSec = tf === '1h' ? 3600 : tf === '4h' ? 14400 : 86400;
    
    // Generate seed from symbol
    const seed = symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    
    const bars: PriceBar[] = [];
    let price = base;
    
    for (let t = from; t <= to; t += tfSec) {
      // Deterministic pseudo-random walk
      const daySeed = Math.floor(t / 86400);
      const hourSeed = Math.floor(t / 3600);
      const combined = (daySeed * seed + hourSeed) % 10000;
      const rand = combined / 10000;
      
      // Daily volatility ~1-2%
      const volatility = tf === '1d' ? 0.015 : tf === '4h' ? 0.005 : 0.002;
      const change = (rand - 0.5) * volatility * 2;
      
      price = price * (1 + change);
      
      // Add intraday range
      const rangeMult = volatility * rand;
      const high = price * (1 + rangeMult);
      const low = price * (1 - rangeMult);
      const open = (high + low) / 2 * (0.99 + rand * 0.02);
      
      bars.push({
        t,
        open,
        high,
        low,
        close: price,
        volume: Math.floor(1000000 * rand),
      });
    }
    
    return bars;
  }
  
  async getLatestPrice(symbol: string): Promise<number | null> {
    const now = Math.floor(Date.now() / 1000);
    const bars = await this.getSeries({
      symbol,
      from: now - 86400,
      to: now,
      tf: '1d',
    });
    
    return bars.length > 0 ? bars[bars.length - 1].close : null;
  }
}

// Singleton
let syntheticInstance: SyntheticDirPriceAdapter | null = null;

export function getSyntheticDirPriceAdapter(): SyntheticDirPriceAdapter {
  if (!syntheticInstance) {
    syntheticInstance = new SyntheticDirPriceAdapter();
  }
  return syntheticInstance;
}

console.log('[Exchange ML] Synthetic direction price adapter loaded');
