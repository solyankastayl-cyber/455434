/**
 * PHASE 1 — Coinbase Spot Provider Types
 * ========================================
 * 
 * Types for Coinbase spot market data.
 * Role: CONFIRMATION LAYER (downgrade only)
 */

export interface CoinbaseTicker {
  price: number;
  bid: number;
  ask: number;
  volume: number;
  time: number;
  source: 'coinbase';
}

export interface CoinbaseCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: 'coinbase';
}

export interface CoinbaseTrade {
  tradeId: number;
  price: number;
  size: number;
  side: 'buy' | 'sell';
  time: number;
}

export interface CoinbaseSpotContext {
  symbol: string;
  spotPrice: number;
  spotVolume24h: number;
  spotBias: 'BUY' | 'SELL' | 'NEUTRAL';
  volumeDelta: number;       // compared to average
  priceDelta: number;        // vs derivatives
  divergence: boolean;       // spot vs derivatives mismatch
  confidence: number;
  dataMode: 'LIVE' | 'MOCK' | 'NO_DATA';
  timestamp: number;
}

// Coinbase API response types
export interface CoinbaseTickerResponse {
  trade_id: number;
  price: string;
  size: string;
  time: string;
  bid: string;
  ask: string;
  volume: string;
}

export interface CoinbaseCandleResponse {
  // [time, low, high, open, close, volume]
  0: number;
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface CoinbaseTradeResponse {
  trade_id: number;
  price: string;
  size: string;
  side: 'buy' | 'sell';
  time: string;
}

console.log('[Phase 1] Coinbase Spot Types loaded');
