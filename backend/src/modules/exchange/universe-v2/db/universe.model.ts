/**
 * BLOCK 2.10 — Universe Model
 * ============================
 * Stores scanned symbols from exchanges.
 */

import type { ObjectId } from 'mongodb';

export type VenueType = 'binance' | 'bybit' | 'hyperliquid';
export type MarketType = 'spot' | 'perp';

export interface UniverseSymbolDoc {
  _id?: ObjectId;
  symbol: string;              // "ARBUSDT"
  base: string;                // "ARB"
  quote: string;               // "USDT"
  venue: VenueType;
  marketType: MarketType;
  enabled: boolean;

  // Liquidity filters
  avgUsdVolume24h?: number;
  lastPrice?: number;

  // Derivatives flags
  hasFunding?: boolean;
  hasOI?: boolean;
  hasLiquidations?: boolean;

  // Quality
  liquidityTier?: 'LOW' | 'MID' | 'HIGH';

  updatedAt: Date;
  createdAt: Date;
}

export interface VenueMarket {
  symbol: string;              // "ARBUSDT"
  base: string;                // "ARB"
  quote: string;               // "USDT"
  marketType: MarketType;
  enabled: boolean;

  // Fast info
  lastPrice?: number;
  volumeUsd24h?: number;
  openInterestUsd?: number;    // Open Interest in USD

  hasFunding?: boolean;
  hasOI?: boolean;
  hasLiquidations?: boolean;
}

export interface IVenueUniversePort {
  venue(): VenueType;
  listMarkets(): Promise<VenueMarket[]>;
}

export interface UniverseScanResult {
  venue: string;
  fetched: number;
  upserted: number;
  disabled: number;
  filteredOut: number;
  errors: string[];
}

console.log('[Universe] Model loaded');
