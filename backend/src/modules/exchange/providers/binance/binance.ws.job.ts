/**
 * PHASE 1 — Binance WebSocket Job
 * =================================
 * 
 * Background job for real-time Binance data ingestion.
 * Manages WebSocket connections and updates MarketCache.
 */

import { BinanceWsClient } from './binance.ws.client.js';
import { BinanceOrderbookSync } from './orderbook/orderbook.sync.js';
import { createEmptyState, toSortedLevels, computeMidPrice } from './orderbook/orderbook.state.js';
import { BinanceDepthEvent } from './orderbook/orderbook.types.js';
import { marketCache } from '../../cache/market.cache.js';
import { Liquidation } from '../../cache/market.cache.types.js';
import * as rest from './binance.rest.client.js';

// ═══════════════════════════════════════════════════════════════
// JOB CONFIG
// ═══════════════════════════════════════════════════════════════

export interface BinanceWsJobConfig {
  symbols: string[];
  streams: ('depth' | 'kline' | 'forceOrder')[];
  klineInterval?: string;
}

// ═══════════════════════════════════════════════════════════════
// WS JOB
// ═══════════════════════════════════════════════════════════════

export class BinanceWsJob {
  private wsClient: BinanceWsClient | null = null;
  private orderbookSyncs = new Map<string, BinanceOrderbookSync>();
  private running = false;
  
  constructor(private config: BinanceWsJobConfig) {}
  
  // ═════════════════════════════════════════════════════════════
  // START
  // ═════════════════════════════════════════════════════════════
  
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    
    console.log(`[Binance WS Job] Starting for ${this.config.symbols.length} symbols`);
    
    // Initialize orderbook sync engines
    for (const symbol of this.config.symbols) {
      const state = createEmptyState(symbol);
      const sync = new BinanceOrderbookSync(symbol, state);
      this.orderbookSyncs.set(symbol, sync);
    }
    
    // Bootstrap candles via REST
    await this.bootstrapCandles();
    
    // Build stream list
    const streams = this.buildStreamList();
    
    // Connect WebSocket
    this.wsClient = new BinanceWsClient();
    this.wsClient.connect(streams, (msg) => this.handleMessage(msg));
  }
  
  // ═════════════════════════════════════════════════════════════
  // STOP
  // ═════════════════════════════════════════════════════════════
  
  stop(): void {
    this.running = false;
    this.wsClient?.stop();
    this.wsClient = null;
    this.orderbookSyncs.clear();
    console.log('[Binance WS Job] Stopped');
  }
  
  // ═════════════════════════════════════════════════════════════
  // BOOTSTRAP CANDLES
  // ═════════════════════════════════════════════════════════════
  
  private async bootstrapCandles(): Promise<void> {
    const tf = this.config.klineInterval || '1m';
    
    for (const symbol of this.config.symbols) {
      try {
        const candles = await rest.fetchKlines(symbol, tf, 500);
        marketCache.setCandles(symbol, tf, candles);
        marketCache.setProvider(symbol, 'BINANCE_USDM');
        console.log(`[Binance WS Job] Bootstrapped ${candles.length} candles for ${symbol}`);
      } catch (error: any) {
        console.error(`[Binance WS Job] Failed to bootstrap ${symbol}:`, error.message);
      }
    }
  }
  
  // ═════════════════════════════════════════════════════════════
  // BUILD STREAM LIST
  // ═════════════════════════════════════════════════════════════
  
  private buildStreamList(): string[] {
    const streams: string[] = [];
    const tf = this.config.klineInterval || '1m';
    
    for (const symbol of this.config.symbols) {
      const sym = symbol.toLowerCase();
      
      if (this.config.streams.includes('depth')) {
        streams.push(`${sym}@depth@100ms`);
      }
      
      if (this.config.streams.includes('kline')) {
        streams.push(`${sym}@kline_${tf}`);
      }
      
      if (this.config.streams.includes('forceOrder')) {
        streams.push(`${sym}@forceOrder`);
      }
    }
    
    return streams;
  }
  
  // ═════════════════════════════════════════════════════════════
  // HANDLE MESSAGE
  // ═════════════════════════════════════════════════════════════
  
  private handleMessage(payload: any): void {
    // Combined stream format: { stream: "...", data: {...} }
    const stream = payload?.stream ?? '';
    const data = payload?.data;
    
    if (!data) return;
    
    if (stream.includes('@depth@')) {
      this.handleDepth(data as BinanceDepthEvent);
    } else if (stream.includes('@kline_')) {
      this.handleKline(data);
    } else if (stream.includes('@forceOrder')) {
      this.handleLiquidation(data);
    }
  }
  
  // ═════════════════════════════════════════════════════════════
  // HANDLE DEPTH
  // ═════════════════════════════════════════════════════════════
  
  private handleDepth(ev: BinanceDepthEvent): void {
    const sync = this.orderbookSyncs.get(ev.s);
    if (!sync) return;
    
    // Feed to sync engine
    sync.onDiff(ev);
    
    // Update cache if ready
    const state = sync.getState();
    if (state.ready) {
      const bids = toSortedLevels(state.bids, 'bids', 200);
      const asks = toSortedLevels(state.asks, 'asks', 200);
      const mid = computeMidPrice(state);
      
      marketCache.setOrderbook(ev.s, {
        symbol: ev.s,
        ts: Date.now(),
        lastUpdateId: state.lastUpdateId,
        bids: bids.map(l => ({ p: l.p, q: l.q })),
        asks: asks.map(l => ({ p: l.p, q: l.q })),
        ready: true,
        mid,
      });
    }
  }
  
  // ═════════════════════════════════════════════════════════════
  // HANDLE KLINE
  // ═════════════════════════════════════════════════════════════
  
  private handleKline(data: any): void {
    const k = data.k;
    const symbol = data.s;
    const tf = k.i;
    
    const candle = {
      t: k.t,
      o: Number(k.o),
      h: Number(k.h),
      l: Number(k.l),
      c: Number(k.c),
      v: Number(k.v),
      closed: k.x,
    };
    
    marketCache.updateLastCandle(symbol, tf, candle);
  }
  
  // ═════════════════════════════════════════════════════════════
  // HANDLE LIQUIDATION
  // ═════════════════════════════════════════════════════════════
  
  private handleLiquidation(data: any): void {
    const o = data.o;
    const symbol = o.s;
    
    const liq: Liquidation = {
      ts: Number(o.T),
      symbol,
      side: o.S === 'SELL' ? 'SELL' : 'BUY',
      price: Number(o.p),
      qty: Number(o.q),
      notional: Number(o.p) * Number(o.q),
    };
    
    marketCache.pushLiquidation(symbol, liq);
  }
  
  // ═════════════════════════════════════════════════════════════
  // STATUS
  // ═════════════════════════════════════════════════════════════
  
  getStatus() {
    const syncs: any[] = [];
    
    for (const [symbol, sync] of this.orderbookSyncs) {
      syncs.push(sync.getStatus());
    }
    
    return {
      running: this.running,
      connected: this.wsClient?.isConnected() ?? false,
      symbols: this.config.symbols,
      orderbookStatus: syncs,
    };
  }
  
  isRunning(): boolean {
    return this.running;
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════

let jobInstance: BinanceWsJob | null = null;

export function getBinanceWsJob(): BinanceWsJob | null {
  return jobInstance;
}

export function createBinanceWsJob(config: BinanceWsJobConfig): BinanceWsJob {
  if (jobInstance) {
    jobInstance.stop();
  }
  jobInstance = new BinanceWsJob(config);
  return jobInstance;
}

export function stopBinanceWsJob(): void {
  jobInstance?.stop();
  jobInstance = null;
}

console.log('[Phase 1] Binance WebSocket Job loaded');
