/**
 * PHASE 1 — Binance Orderbook Types
 * ===================================
 */

export interface OrderbookLevel {
  p: number;
  q: number;
}

export interface BinanceDepthSnapshot {
  lastUpdateId: number;
  E: number; // Message output time
  T: number; // Transaction time
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceDepthEvent {
  e: 'depthUpdate';
  E: number;  // Event time
  T: number;  // Transaction time
  s: string;  // Symbol
  U: number;  // First update ID in event
  u: number;  // Final update ID in event
  pu: number; // Final update ID in last stream (only for @100ms/@500ms)
  b: [string, string][]; // Bids [price, qty]
  a: [string, string][]; // Asks [price, qty]
}

export type OrderbookSyncStatus = 'BUFFERING' | 'SYNCING' | 'READY' | 'ERROR';

export interface OrderbookState {
  symbol: string;
  lastUpdateId: number;
  bids: Map<number, number>;
  asks: Map<number, number>;
  ready: boolean;
  status: OrderbookSyncStatus;
  lastEventTime?: number;
  errorReason?: string;
}

console.log('[Phase 1] Binance Orderbook Types loaded');
