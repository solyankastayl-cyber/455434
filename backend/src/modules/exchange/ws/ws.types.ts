/**
 * PHASE 1.2 — WebSocket Types
 * ===========================
 */

export type WsProviderId = 'BYBIT' | 'BINANCE';

export type WsStream = 'orderbook' | 'trades';

export type WsState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'DEGRADED' | 'DOWN';

export interface WsProviderConfig {
  providerId: WsProviderId;
  enabled: boolean;
  streams: WsStream[];
  symbols: string[];
}

export interface WsStatus {
  provider: WsProviderId;
  state: WsState;
  enabled: boolean;
  streams: WsStream[];
  symbols: string[];
  startedAt?: string;
  lastHeartbeatAt?: string;
  reconnects: number;
  errors: number;
  lastError?: string;
}

export interface TradeTick {
  symbol: string;
  price: number;
  qty: number;
  ts: number;
  side?: 'BUY' | 'SELL';
  provider: WsProviderId;
}

export interface OrderbookUpdate {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  ts: number;
  provider: WsProviderId;
}

console.log('[Phase 1.2] WS Types loaded');
