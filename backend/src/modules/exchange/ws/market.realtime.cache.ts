/**
 * PHASE 1.2 — Real-time Market Cache
 * ===================================
 * Stores live trades and orderbook updates from WebSocket
 */

import { TradeTick, OrderbookUpdate, WsProviderId } from './ws.types.js';

type RealtimeBar = {
  symbol: string;
  lastPrice?: number;
  lastTs?: number;
  vol1m: number;
  vol1mNotional: number;
  bestBid?: number;
  bestAsk?: number;
  mid?: number;
  spread?: number;
  provider?: WsProviderId;
  tradesCount1m: number;
};

type Sample = { ts: number; qty: number; notional: number };

class MarketRealtimeCache {
  private state = new Map<string, RealtimeBar>();
  private samples = new Map<string, Sample[]>();
  private orderbooks = new Map<string, OrderbookUpdate>();
  
  upsertTrade(t: TradeTick): void {
    const key = t.symbol;
    const cur = this.state.get(key) ?? {
      symbol: key,
      vol1m: 0,
      vol1mNotional: 0,
      tradesCount1m: 0,
    };
    
    // Add sample
    const arr = this.samples.get(key) ?? [];
    arr.push({ ts: t.ts, qty: t.qty, notional: t.qty * t.price });
    
    // Prune >60s
    const cutoff = t.ts - 60_000;
    while (arr.length && arr[0].ts < cutoff) arr.shift();
    
    // Recompute rolling
    let v = 0;
    let n = 0;
    for (const s of arr) {
      v += s.qty;
      n += s.notional;
    }
    
    this.samples.set(key, arr);
    this.state.set(key, {
      ...cur,
      lastPrice: t.price,
      lastTs: t.ts,
      vol1m: v,
      vol1mNotional: n,
      tradesCount1m: arr.length,
      provider: t.provider,
    });
  }
  
  upsertOrderbook(ob: OrderbookUpdate): void {
    this.orderbooks.set(ob.symbol, ob);
    
    const cur = this.state.get(ob.symbol) ?? {
      symbol: ob.symbol,
      vol1m: 0,
      vol1mNotional: 0,
      tradesCount1m: 0,
    };
    
    const bestBid = ob.bids[0]?.[0] ?? 0;
    const bestAsk = ob.asks[0]?.[0] ?? 0;
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;
    
    this.state.set(ob.symbol, {
      ...cur,
      bestBid,
      bestAsk,
      mid,
      spread,
      provider: ob.provider,
    });
  }
  
  get(symbol: string): RealtimeBar {
    return this.state.get(symbol) ?? {
      symbol,
      vol1m: 0,
      vol1mNotional: 0,
      tradesCount1m: 0,
    };
  }
  
  getOrderbook(symbol: string): OrderbookUpdate | undefined {
    return this.orderbooks.get(symbol);
  }
  
  list(symbols: string[]): RealtimeBar[] {
    return symbols.map((s) => this.get(s));
  }
  
  listAll(): RealtimeBar[] {
    return Array.from(this.state.values());
  }
  
  hasRealtimeData(symbol: string): boolean {
    const bar = this.state.get(symbol);
    if (!bar?.lastTs) return false;
    // Data is "fresh" if less than 30 seconds old
    return Date.now() - bar.lastTs < 30_000;
  }
  
  getStatus(): { symbols: number; lastUpdate: number; providers: string[] } {
    const providers = new Set<string>();
    let lastUpdate = 0;
    
    for (const bar of this.state.values()) {
      if (bar.provider) providers.add(bar.provider);
      if (bar.lastTs && bar.lastTs > lastUpdate) lastUpdate = bar.lastTs;
    }
    
    return {
      symbols: this.state.size,
      lastUpdate,
      providers: Array.from(providers),
    };
  }
}

export const marketRealtimeCache = new MarketRealtimeCache();

console.log('[Phase 1.2] Market Realtime Cache loaded');
