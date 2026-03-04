/**
 * PHASE 1 — Binance REST Client
 * ===============================
 * 
 * REST API client for Binance Futures.
 * Uses httpClientFactory for proxy support.
 */

import { createBinanceClient } from '../../../network/httpClient.factory.js';
import { Candle } from '../../cache/market.cache.types.js';

// ═══════════════════════════════════════════════════════════════
// CANDLES (Klines)
// ═══════════════════════════════════════════════════════════════

interface BinanceKline {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
  7: string;  // Quote volume
  8: number;  // Number of trades
  9: string;  // Taker buy base volume
  10: string; // Taker buy quote volume
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number = 500
): Promise<Candle[]> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/klines', {
    params: { symbol, interval, limit },
  });
  
  return (res.data as BinanceKline[]).map(k => ({
    t: k[0],
    o: Number(k[1]),
    h: Number(k[2]),
    l: Number(k[3]),
    c: Number(k[4]),
    v: Number(k[5]),
    closed: true, // Historical candles are always closed
  }));
}

// ═══════════════════════════════════════════════════════════════
// ORDERBOOK SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface DepthSnapshot {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: [string, string][];
  asks: [string, string][];
}

export async function fetchDepthSnapshot(
  symbol: string,
  limit: number = 1000
): Promise<DepthSnapshot> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/depth', {
    params: { symbol, limit },
  });
  return res.data;
}

// ═══════════════════════════════════════════════════════════════
// OPEN INTEREST
// ═══════════════════════════════════════════════════════════════

export interface OpenInterestResponse {
  symbol: string;
  openInterest: string;
  time: number;
}

export async function fetchOpenInterest(symbol: string): Promise<OpenInterestResponse> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/openInterest', {
    params: { symbol },
  });
  return res.data;
}

// ═══════════════════════════════════════════════════════════════
// FUNDING RATE
// ═══════════════════════════════════════════════════════════════

export interface FundingRateResponse {
  symbol: string;
  fundingRate: string;
  fundingTime: number;
  time: number;
}

export async function fetchFundingRate(
  symbol: string,
  limit: number = 1
): Promise<FundingRateResponse[]> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/fundingRate', {
    params: { symbol, limit },
  });
  return res.data;
}

// ═══════════════════════════════════════════════════════════════
// PREMIUM INDEX (includes current funding + next funding time)
// ═══════════════════════════════════════════════════════════════

export interface PremiumIndexResponse {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  time: number;
}

export async function fetchPremiumIndex(symbol: string): Promise<PremiumIndexResponse> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/premiumIndex', {
    params: { symbol },
  });
  return res.data;
}

// ═══════════════════════════════════════════════════════════════
// EXCHANGE INFO (for symbols list)
// ═══════════════════════════════════════════════════════════════

export interface ExchangeInfoSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  onboardDate: number;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface ExchangeInfoResponse {
  symbols: ExchangeInfoSymbol[];
}

export async function fetchExchangeInfo(): Promise<ExchangeInfoResponse> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/exchangeInfo');
  return res.data;
}

// ═══════════════════════════════════════════════════════════════
// TICKER 24h (for volume, price change)
// ═══════════════════════════════════════════════════════════════

export interface Ticker24hResponse {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  count: number;
}

export async function fetchTicker24h(symbol?: string): Promise<Ticker24hResponse | Ticker24hResponse[]> {
  const client = await createBinanceClient();
  const res = await client.get('/fapi/v1/ticker/24hr', {
    params: symbol ? { symbol } : {},
  });
  return res.data;
}

console.log('[Phase 1] Binance REST Client loaded');
