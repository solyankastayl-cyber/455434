/**
 * БЛОК 1.1 — Funding Types
 * ========================
 * Единый контракт для funding rate с разных бирж
 */

export type FundingVenue = 'BINANCE' | 'BYBIT' | 'HYPERLIQUID' | 'COINBASE';

export type FundingInterval = '8h' | '1h' | 'unknown';

export interface FundingSample {
  venue: FundingVenue;
  symbol: string;              // e.g. "BTCUSDT", "SOLUSDT"
  ts: number;                  // unix ms
  interval: FundingInterval;

  // raw funding rate for the interval (e.g. 0.0001 = 0.01%)
  fundingRate: number;

  // optional: additional derivatives context
  markPrice?: number;
  indexPrice?: number;
  openInterestUsd?: number;
  perpVolumeUsd24h?: number;

  // data quality
  sourceLatencyMs?: number;
}

export interface FundingQuery {
  symbols: string[];
  asOfTs?: number;  // for historical reads
}

export interface FundingReadResult {
  venue: FundingVenue;
  asOfTs: number;
  samples: FundingSample[];
  partial: boolean;            // true if some symbols failed
  errors?: Array<{ symbol: string; reason: string }>;
}

console.log('[Funding] Types loaded');
