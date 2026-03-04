/**
 * PHASE 1 — Binance WebSocket Client
 * ====================================
 * 
 * WebSocket client for real-time Binance Futures data.
 * Auto-reconnect with exponential backoff.
 */

import WebSocket from 'ws';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type WsMessageHandler = (msg: any) => void;

export interface WsClientOptions {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
  reconnect?: boolean;
  maxReconnectDelay?: number;
}

// ═══════════════════════════════════════════════════════════════
// WEBSOCKET CLIENT
// ═══════════════════════════════════════════════════════════════

export class BinanceWsClient {
  private ws: WebSocket | null = null;
  private stopped = false;
  private retryCount = 0;
  private readonly maxRetryDelay: number;
  
  constructor(
    private readonly wsBase: string = 'wss://fstream.binance.com/stream',
    private readonly options: WsClientOptions = {},
  ) {
    this.maxRetryDelay = options.maxReconnectDelay ?? 30000;
  }
  
  // ═════════════════════════════════════════════════════════════
  // CONNECT
  // ═════════════════════════════════════════════════════════════
  
  connect(streams: string[], onMessage: WsMessageHandler): void {
    this.stopped = false;
    this.doConnect(streams, onMessage);
  }
  
  private doConnect(streams: string[], onMessage: WsMessageHandler): void {
    if (this.stopped) return;
    
    const url = `${this.wsBase}?streams=${streams.join('/')}`;
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        console.log(`[Binance WS] Connected to ${streams.length} streams`);
        this.retryCount = 0;
        this.options.onOpen?.();
      });
      
      this.ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          onMessage(parsed);
        } catch (e) {
          // Ignore malformed messages
        }
      });
      
      this.ws.on('close', () => {
        console.log('[Binance WS] Connection closed');
        this.options.onClose?.();
        
        if (!this.stopped && this.options.reconnect !== false) {
          this.scheduleReconnect(streams, onMessage);
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('[Binance WS] Error:', error.message);
        this.options.onError?.(error);
        
        // Close will trigger reconnect
        try { this.ws?.close(); } catch {}
      });
      
    } catch (error: any) {
      console.error('[Binance WS] Failed to connect:', error.message);
      if (!this.stopped && this.options.reconnect !== false) {
        this.scheduleReconnect(streams, onMessage);
      }
    }
  }
  
  // ═════════════════════════════════════════════════════════════
  // RECONNECT
  // ═════════════════════════════════════════════════════════════
  
  private scheduleReconnect(streams: string[], onMessage: WsMessageHandler): void {
    this.retryCount++;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, ... max 30s
    const delay = Math.min(
      1000 * Math.pow(2, Math.min(this.retryCount - 1, 5)),
      this.maxRetryDelay
    );
    
    console.log(`[Binance WS] Reconnecting in ${delay}ms (attempt ${this.retryCount})`);
    
    setTimeout(() => this.doConnect(streams, onMessage), delay);
  }
  
  // ═════════════════════════════════════════════════════════════
  // STOP
  // ═════════════════════════════════════════════════════════════
  
  stop(): void {
    this.stopped = true;
    try {
      this.ws?.close();
    } catch {}
    this.ws = null;
    console.log('[Binance WS] Stopped');
  }
  
  // ═════════════════════════════════════════════════════════════
  // STATUS
  // ═════════════════════════════════════════════════════════════
  
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  getRetryCount(): number {
    return this.retryCount;
  }
}

console.log('[Phase 1] Binance WebSocket Client loaded');
