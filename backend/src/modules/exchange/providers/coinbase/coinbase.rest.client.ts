/**
 * PHASE 1 — Coinbase REST Client
 * ================================
 * 
 * REST API client for Coinbase Exchange (spot).
 * Uses httpClientFactory for proxy support.
 */

import { createHttpClient } from '../../../network/httpClient.factory.js';
import {
  CoinbaseTicker,
  CoinbaseCandle,
  CoinbaseTrade,
  CoinbaseTickerResponse,
  CoinbaseCandleResponse,
  CoinbaseTradeResponse,
} from './coinbase.spot.types.js';

const COINBASE_API = 'https://api.exchange.coinbase.com';

// ═══════════════════════════════════════════════════════════════
// SYMBOL MAPPING
// ═══════════════════════════════════════════════════════════════

/**
 * Map BTCUSDT -> BTC-USD format
 */
export function mapSymbol(symbol: string): string {
  // BTCUSDT -> BTC-USD
  if (symbol.endsWith('USDT')) {
    const base = symbol.replace('USDT', '');
    return `${base}-USD`;
  }
  // Already in correct format
  if (symbol.includes('-')) {
    return symbol;
  }
  // Default: append -USD
  return `${symbol}-USD`;
}

// ═══════════════════════════════════════════════════════════════
// CREATE CLIENT
// ═══════════════════════════════════════════════════════════════

async function createCoinbaseClient() {
  return createHttpClient({
    baseURL: COINBASE_API,
    timeout: 8000,
  });
}

// ═══════════════════════════════════════════════════════════════
// TICKER
// ═══════════════════════════════════════════════════════════════

export async function fetchTicker(symbol: string): Promise<CoinbaseTicker> {
  const pair = mapSymbol(symbol);
  const client = await createCoinbaseClient();
  
  const res = await client.get<CoinbaseTickerResponse>(`/products/${pair}/ticker`);
  
  return {
    price: Number(res.data.price),
    bid: Number(res.data.bid),
    ask: Number(res.data.ask),
    volume: Number(res.data.volume),
    time: new Date(res.data.time).getTime(),
    source: 'coinbase',
  };
}

// ═══════════════════════════════════════════════════════════════
// CANDLES
// ═══════════════════════════════════════════════════════════════

const GRANULARITY_MAP: Record<string, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

export async function fetchCandles(
  symbol: string,
  interval: string = '1h',
  limit: number = 100
): Promise<CoinbaseCandle[]> {
  const pair = mapSymbol(symbol);
  const granularity = GRANULARITY_MAP[interval] ?? 3600;
  
  const client = await createCoinbaseClient();
  
  const res = await client.get<CoinbaseCandleResponse[]>(`/products/${pair}/candles`, {
    params: { granularity },
  });
  
  // Coinbase returns newest first, we want oldest first
  const candles = res.data.slice(0, limit).reverse();
  
  return candles.map(c => ({
    time: c[0] * 1000,
    low: c[1],
    high: c[2],
    open: c[3],
    close: c[4],
    volume: c[5],
    source: 'coinbase' as const,
  }));
}

// ═══════════════════════════════════════════════════════════════
// TRADES
// ═══════════════════════════════════════════════════════════════

export async function fetchTrades(
  symbol: string,
  limit: number = 100
): Promise<CoinbaseTrade[]> {
  const pair = mapSymbol(symbol);
  const client = await createCoinbaseClient();
  
  const res = await client.get<CoinbaseTradeResponse[]>(`/products/${pair}/trades`, {
    params: { limit },
  });
  
  return res.data.map(t => ({
    tradeId: t.trade_id,
    price: Number(t.price),
    size: Number(t.size),
    side: t.side,
    time: new Date(t.time).getTime(),
  }));
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  
  try {
    const client = await createCoinbaseClient();
    await client.get('/time');
    
    return {
      ok: true,
      latencyMs: Date.now() - start,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error.message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTS LIST
// ═══════════════════════════════════════════════════════════════

export interface CoinbaseProduct {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: string;
}

export async function fetchProducts(): Promise<CoinbaseProduct[]> {
  const client = await createCoinbaseClient();
  const res = await client.get<CoinbaseProduct[]>('/products');
  
  // Filter for USD pairs that are trading
  return res.data.filter(p => 
    p.quote_currency === 'USD' && 
    p.status === 'online'
  );
}

console.log('[Phase 1] Coinbase REST Client loaded');
