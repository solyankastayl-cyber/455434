/**
 * PHASE 1.2 — Bybit WebSocket Client
 * ===================================
 * Connects to Bybit v5 public linear streams
 * wss://stream.bybit.com/v5/public/linear
 */

import WebSocket from 'ws';
import { TradeTick, WsProviderId } from './ws.types.js';

type BybitWsClientDeps = {
  url: string;
  symbols: string[];
  wsOptions?: WebSocket.ClientOptions;
  onTrade: (t: TradeTick) => void;
  onHeartbeat: () => void;
  onError: (err: Error) => void;
  onClose: () => void;
};

export class BybitWsClient {
  private ws?: WebSocket;
  private readonly provider: WsProviderId = 'BYBIT';
  private pingTimer?: NodeJS.Timeout;
  private isRunning = false;
  
  constructor(private deps: BybitWsClientDeps) {}
  
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log(`[BybitWS] Connecting to ${this.deps.url}...`);
    
    this.ws = new WebSocket(this.deps.url, this.deps.wsOptions);
    
    this.ws.on('open', () => {
      console.log('[BybitWS] Connected, subscribing to trades...');
      
      // Subscribe to trades
      const args = this.deps.symbols.map((s) => `publicTrade.${s}`);
      this.ws?.send(JSON.stringify({ op: 'subscribe', args }));
      this.deps.onHeartbeat();
      
      // Keepalive ping every 15s
      this.pingTimer = setInterval(() => {
        try {
          this.ws?.send(JSON.stringify({ op: 'ping' }));
        } catch {}
      }, 15_000);
    });
    
    this.ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        // Heartbeat response
        if (msg?.op === 'pong') {
          this.deps.onHeartbeat();
          return;
        }
        
        // Subscription confirmation
        if (msg?.success === true && msg?.op === 'subscribe') {
          console.log('[BybitWS] Subscription confirmed');
          return;
        }
        
        // Trade data: { topic:"publicTrade.BTCUSDT", data:[{p:"70000", v:"0.01", T:..., S:"Buy"}] }
        if (typeof msg?.topic === 'string' && msg.topic.startsWith('publicTrade.')) {
          const symbol = msg.topic.replace('publicTrade.', '');
          const data = Array.isArray(msg.data) ? msg.data : [];
          
          for (const x of data) {
            const price = Number(x.p);
            const qty = Number(x.v);
            const ts = Number(x.T ?? x.t ?? Date.now());
            const side = x.S === 'Buy' ? 'BUY' : x.S === 'Sell' ? 'SELL' : undefined;
            
            if (Number.isFinite(price) && Number.isFinite(qty)) {
              this.deps.onTrade({ symbol, price, qty, ts, side, provider: this.provider });
            }
          }
          this.deps.onHeartbeat();
        }
      } catch (e) {
        // Ignore parse errors
      }
    });
    
    this.ws.on('error', (err) => {
      console.error('[BybitWS] Error:', err.message);
      this.deps.onError(err as Error);
    });
    
    this.ws.on('close', () => {
      console.log('[BybitWS] Connection closed');
      this.cleanup();
      this.deps.onClose();
    });
  }
  
  stop(): void {
    this.isRunning = false;
    this.cleanup();
    this.ws?.close();
    this.ws = undefined;
  }
  
  private cleanup(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }
}

console.log('[Phase 1.2] Bybit WS Client loaded');
