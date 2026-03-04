/**
 * PHASE 1.2 — Binance WebSocket Client
 * =====================================
 * Connects to Binance Futures streams
 * wss://fstream.binance.com/stream?streams=btcusdt@trade/ethusdt@trade
 */

import WebSocket from 'ws';
import { TradeTick, WsProviderId } from './ws.types.js';

type BinanceWsClientDeps = {
  baseUrl: string;
  symbols: string[];
  wsOptions?: WebSocket.ClientOptions;
  onTrade: (t: TradeTick) => void;
  onHeartbeat: () => void;
  onError: (err: Error) => void;
  onClose: () => void;
};

export class BinanceWsClient {
  private ws?: WebSocket;
  private readonly provider: WsProviderId = 'BINANCE';
  private isRunning = false;
  
  constructor(private deps: BinanceWsClientDeps) {}
  
  private buildUrl(): string {
    const streams = this.deps.symbols
      .map((s) => `${s.toLowerCase()}@trade`)
      .join('/');
    return `${this.deps.baseUrl}/stream?streams=${streams}`;
  }
  
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    const url = this.buildUrl();
    console.log(`[BinanceWS] Connecting to ${url}...`);
    
    this.ws = new WebSocket(url, this.deps.wsOptions);
    
    this.ws.on('open', () => {
      console.log('[BinanceWS] Connected');
      this.deps.onHeartbeat();
    });
    
    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const data = msg?.data;
        
        // Trade event: { e:"trade", s:"BTCUSDT", p:"70000.1", q:"0.002", T:..., m:true }
        if (data?.e === 'trade' && data?.s) {
          const symbol = String(data.s);
          const price = Number(data.p);
          const qty = Number(data.q);
          const ts = Number(data.T ?? Date.now());
          // m = is buyer the market maker -> if true, then trade was SELL aggressor
          const side = data.m === true ? 'SELL' : 'BUY';
          
          if (Number.isFinite(price) && Number.isFinite(qty)) {
            this.deps.onTrade({ symbol, price, qty, ts, side, provider: this.provider });
            this.deps.onHeartbeat();
          }
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    this.ws.on('error', (err) => {
      console.error('[BinanceWS] Error:', err.message);
      this.deps.onError(err as Error);
    });
    
    this.ws.on('close', () => {
      console.log('[BinanceWS] Connection closed');
      this.deps.onClose();
    });
  }
  
  stop(): void {
    this.isRunning = false;
    this.ws?.close();
    this.ws = undefined;
  }
}

console.log('[Phase 1.2] Binance WS Client loaded');
