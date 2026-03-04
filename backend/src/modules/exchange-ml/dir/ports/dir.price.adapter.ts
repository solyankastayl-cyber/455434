/**
 * Direction Price Adapter
 * =======================
 * 
 * Adapts the existing price history service to DirPricePort interface.
 */

import { DirPricePort, TF, PriceBar as DirPriceBar } from './dir.price.port.js';
import { getPriceBars } from '../../../market/history/priceHistory.service.js';
import { Timeframe, PriceBar } from '../../../market/history/history.types.js';

/**
 * Maps TF to Timeframe
 */
function tfToTimeframe(tf: TF): Timeframe {
  switch (tf) {
    case '1h': return '1h';
    case '4h': return '4h';
    case '1d': return '1d';
    default: return '1d';
  }
}

/**
 * Adapter implementation
 */
export class DirPriceAdapter implements DirPricePort {
  async getSeries(params: {
    symbol: string;
    from: number;
    to: number;
    tf: TF;
  }): Promise<DirPriceBar[]> {
    const { symbol, from, to, tf } = params;
    
    // Convert seconds to milliseconds for DB query
    const fromMs = from * 1000;
    const toMs = to * 1000;
    
    // Fetch from DB
    const bars = await getPriceBars({
      symbol: symbol.toUpperCase(),
      tf: tfToTimeframe(tf),
      from: fromMs,
      to: toMs,
    });
    
    // Map to DirPriceBar format
    return bars.map((bar: PriceBar) => ({
      t: Math.floor(bar.ts / 1000), // Convert ms to sec
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  }
  
  async getLatestPrice(symbol: string): Promise<number | null> {
    const now = Math.floor(Date.now() / 1000);
    const bars = await this.getSeries({
      symbol,
      from: now - 86400, // Last 24h
      to: now,
      tf: '1h',
    });
    
    if (bars.length === 0) return null;
    return bars[bars.length - 1].close;
  }
}

// Singleton instance
let adapterInstance: DirPriceAdapter | null = null;

export function getDirPriceAdapter(): DirPriceAdapter {
  if (!adapterInstance) {
    adapterInstance = new DirPriceAdapter();
  }
  return adapterInstance;
}

console.log('[Exchange ML] Direction price adapter loaded');
