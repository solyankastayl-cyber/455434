/**
 * BLOCK 2.11 — Exchange Symbol Snapshot Model
 * ============================================
 * Stores computed features for each symbol at regular intervals.
 */

import type { ObjectId } from 'mongodb';

export type TimeFrame = '1m' | '5m' | '15m' | '1h';

export interface ExchangeSymbolSnapshotDoc {
  _id?: ObjectId;

  // Identity
  symbolKey: string;           // "ARB:USDT:perp:binance" (stable key)
  base: string;                // "ARB"
  quote: string;               // "USDT"
  venue: 'binance' | 'bybit' | 'hyperliquid';
  marketType: 'spot' | 'perp';

  // Time
  ts: Date;                    // Snapshot timestamp (rounded to 5m)
  tf: TimeFrame;               // Snapshot timeframe used for features

  // Raw market data
  price: number;
  priceChg1h?: number;
  priceChg24h?: number;
  volumeUsd24h?: number;

  // Derivatives raw (optional)
  oiUsd?: number;
  oiChg1h?: number;
  fundingRate?: number;
  fundingAnnualized?: number;
  liquidationsUsd1h?: number;
  longShortRatio?: number;

  // Orderflow / book proxies (optional)
  buySellImbalance1h?: number;
  bookImbalance?: number;

  // Computed features (40+ indicator space)
  features: Record<string, number | null>;

  // Quality
  dataQuality: {
    sources: string[];
    missing: string[];
    qualityScore: number;
  };

  // Derived tags for fast filtering
  tags?: {
    hasFunding?: boolean;
    hasOI?: boolean;
    hasLiquidations?: boolean;
    liquidityTier?: 'LOW' | 'MID' | 'HIGH';
  };

  createdAt: Date;
}

console.log('[Snapshot] Model loaded');
