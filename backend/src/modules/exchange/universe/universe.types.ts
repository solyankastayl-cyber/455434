/**
 * B2 — Symbol Universe Types
 * 
 * Types for Exchange Universe Builder.
 * Defines which symbols are valid for analysis.
 */

export type ExchangeVenue = 'binance' | 'bybit' | 'hyperliquid';

export type UniverseStatus = 'INCLUDED' | 'WATCH' | 'EXCLUDED';

export interface VenueData {
  enabled: boolean;
  volume24hUsd?: number;
  oiUsd?: number;
  fundingRate?: number;
}

export interface HyperliquidVenueData extends VenueData {
  whalePresence: boolean;
  whaleCount: number;
  netWhaleBiasPct?: number;
  maxPositionUsd?: number;
}

export interface UniverseScores {
  /** Liquidity score: 0..1 */
  liquidityScore: number;
  /** Derivatives score: 0..1 */
  derivativesScore: number;
  /** Whale score: 0..1 */
  whaleScore: number;
  /** Final universe score: 0..1 */
  universeScore: number;
}

export interface UniverseGates {
  liquidityOk: boolean;
  derivativesOk: boolean;
}

export interface UniverseSources {
  price: ExchangeVenue;
  derivatives: ExchangeVenue | 'none';
  whales: 'hyperliquid' | 'none';
}

export interface UniverseRaw {
  volume24h: number;
  openInterest: number;
  fundingRate: number;
  whaleNetBias: number;
  whaleMaxPosition: number;
  whaleCount: number;
}

export interface SymbolUniverseItem {
  symbol: string;
  base: string;
  quote: string;
  
  venues: {
    binance?: VenueData;
    bybit?: VenueData;
    hyperliquid?: HyperliquidVenueData;
  };
  
  scores: UniverseScores;
  gates: UniverseGates;
  sources: UniverseSources;
  raw: UniverseRaw;
  
  status: UniverseStatus;
  reasons: string[];
  
  updatedAt: string;
}

export interface UniverseBuildResult {
  total: number;
  included: number;
  watch: number;
  excluded: number;
  items: SymbolUniverseItem[];
  buildTime: number;
  sources: {
    binance: 'UP' | 'DOWN';
    bybit: 'UP' | 'DOWN';
    hyperliquid: 'UP' | 'DOWN';
  };
}

export interface UniverseHealthResponse {
  symbols: number;
  included: number;
  watch: number;
  excluded: number;
  sources: {
    binance: 'UP' | 'DOWN';
    bybit: 'UP' | 'DOWN';
    hyperliquid: 'UP' | 'DOWN';
  };
  lastBuildAt: string;
}

console.log('[B2] Universe Types loaded');
