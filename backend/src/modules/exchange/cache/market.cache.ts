/**
 * PHASE 1 — Market Cache
 * ========================
 * 
 * In-memory cache for real-time market data.
 * Shared between providers and SnapshotBuilder.
 */

import {
  Candle,
  OrderbookSnapshot,
  Liquidation,
  DerivativesData,
  CacheStatus,
} from './market.cache.types.js';

// ═══════════════════════════════════════════════════════════════
// CACHE CLASS
// ═══════════════════════════════════════════════════════════════

class MarketCacheImpl {
  // Key format: "SYMBOL:TF" for candles
  private candles = new Map<string, Candle[]>();
  
  // Key format: "SYMBOL"
  private orderbooks = new Map<string, OrderbookSnapshot>();
  private liquidations = new Map<string, Liquidation[]>();
  private derivatives = new Map<string, DerivativesData>();
  private providers = new Map<string, string>();
  
  // Limits
  private readonly MAX_CANDLES = 1000;
  private readonly MAX_LIQUIDATIONS = 2000;
  
  // ═════════════════════════════════════════════════════════════
  // CANDLES
  // ═════════════════════════════════════════════════════════════
  
  setCandles(symbol: string, tf: string, items: Candle[]): void {
    const key = `${symbol}:${tf}`;
    // Keep only last MAX_CANDLES
    const trimmed = items.slice(-this.MAX_CANDLES);
    this.candles.set(key, trimmed);
  }
  
  getCandles(symbol: string, tf: string): Candle[] {
    const key = `${symbol}:${tf}`;
    return this.candles.get(key) ?? [];
  }
  
  updateLastCandle(symbol: string, tf: string, candle: Candle): void {
    const key = `${symbol}:${tf}`;
    const arr = this.candles.get(key) ?? [];
    
    // Find and update or append
    const lastIdx = arr.length - 1;
    if (lastIdx >= 0 && arr[lastIdx].t === candle.t) {
      arr[lastIdx] = candle;
    } else {
      arr.push(candle);
      if (arr.length > this.MAX_CANDLES) arr.shift();
    }
    
    this.candles.set(key, arr);
  }
  
  // ═════════════════════════════════════════════════════════════
  // ORDERBOOK
  // ═════════════════════════════════════════════════════════════
  
  setOrderbook(symbol: string, ob: OrderbookSnapshot): void {
    this.orderbooks.set(symbol, ob);
  }
  
  getOrderbook(symbol: string): OrderbookSnapshot | null {
    return this.orderbooks.get(symbol) ?? null;
  }
  
  // ═════════════════════════════════════════════════════════════
  // LIQUIDATIONS
  // ═════════════════════════════════════════════════════════════
  
  pushLiquidation(symbol: string, liq: Liquidation): void {
    const arr = this.liquidations.get(symbol) ?? [];
    arr.push(liq);
    if (arr.length > this.MAX_LIQUIDATIONS) arr.shift();
    this.liquidations.set(symbol, arr);
  }
  
  getLiquidations(symbol: string, windowMs?: number): Liquidation[] {
    const arr = this.liquidations.get(symbol) ?? [];
    if (!windowMs) return arr;
    
    const cutoff = Date.now() - windowMs;
    return arr.filter(l => l.ts >= cutoff);
  }
  
  clearLiquidations(symbol: string): void {
    this.liquidations.set(symbol, []);
  }
  
  // ═════════════════════════════════════════════════════════════
  // DERIVATIVES (OI, Funding)
  // ═════════════════════════════════════════════════════════════
  
  setDerivatives(symbol: string, data: DerivativesData): void {
    this.derivatives.set(symbol, data);
  }
  
  getDerivatives(symbol: string): DerivativesData | null {
    return this.derivatives.get(symbol) ?? null;
  }
  
  // ═════════════════════════════════════════════════════════════
  // PROVIDER TRACKING
  // ═════════════════════════════════════════════════════════════
  
  setProvider(symbol: string, provider: string): void {
    this.providers.set(symbol, provider);
  }
  
  getProvider(symbol: string): string {
    return this.providers.get(symbol) ?? 'UNKNOWN';
  }
  
  // ═════════════════════════════════════════════════════════════
  // STATUS
  // ═════════════════════════════════════════════════════════════
  
  getStatus(symbol: string, tf: string = '1m'): CacheStatus {
    const key = `${symbol}:${tf}`;
    const candles = this.candles.get(key) ?? [];
    const orderbook = this.orderbooks.get(symbol);
    const liquidations = this.liquidations.get(symbol) ?? [];
    const derivatives = this.derivatives.get(symbol);
    const provider = this.providers.get(symbol) ?? 'UNKNOWN';
    
    // Determine data mode
    const now = Date.now();
    const STALE_THRESHOLD = 60000; // 1 minute
    
    let dataMode: 'LIVE' | 'MOCK' | 'STALE' = 'LIVE';
    if (provider === 'MOCK') {
      dataMode = 'MOCK';
    } else if (orderbook && (now - orderbook.ts) > STALE_THRESHOLD) {
      dataMode = 'STALE';
    }
    
    return {
      symbol,
      candlesCount: candles.length,
      candlesLastTs: candles[candles.length - 1]?.t,
      orderbookReady: orderbook?.ready ?? false,
      orderbookLastTs: orderbook?.ts,
      liquidationsCount: liquidations.length,
      derivativesLastTs: derivatives?.ts,
      provider,
      dataMode,
    };
  }
  
  getAllSymbols(): string[] {
    const symbols = new Set<string>();
    
    for (const key of this.candles.keys()) {
      symbols.add(key.split(':')[0]);
    }
    for (const symbol of this.orderbooks.keys()) {
      symbols.add(symbol);
    }
    
    return Array.from(symbols);
  }
  
  // ═════════════════════════════════════════════════════════════
  // CLEANUP
  // ═════════════════════════════════════════════════════════════
  
  clear(symbol?: string): void {
    if (symbol) {
      // Clear specific symbol
      for (const key of this.candles.keys()) {
        if (key.startsWith(symbol + ':')) {
          this.candles.delete(key);
        }
      }
      this.orderbooks.delete(symbol);
      this.liquidations.delete(symbol);
      this.derivatives.delete(symbol);
      this.providers.delete(symbol);
    } else {
      // Clear all
      this.candles.clear();
      this.orderbooks.clear();
      this.liquidations.clear();
      this.derivatives.clear();
      this.providers.clear();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const marketCache = new MarketCacheImpl();

console.log('[Phase 1] Market Cache loaded');
