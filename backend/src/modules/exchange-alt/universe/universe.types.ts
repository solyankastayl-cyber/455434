/**
 * STAGE 2 — Alt Universe Types
 * =============================
 * Defines the universe of altcoins we scan.
 */

import type { Venue } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// UNIVERSE ASSET
// ═══════════════════════════════════════════════════════════════

export interface UniverseAsset {
  symbol: string;           // e.g. "SOLUSDT"
  base: string;             // "SOL"
  quote: string;            // "USDT"
  venue: Venue;
  
  // Status
  enabled: boolean;
  listedAt?: number;        // ms epoch
  delistedAt?: number;      // ms epoch (if delisted)
  
  // Classification
  tags: string[];           // e.g. ["L1", "AI", "MEME", "DEFI"]
  sector?: string;          // e.g. "LAYER1", "DEFI", "GAMING"
  tier?: 'TIER1' | 'TIER2' | 'TIER3';  // liquidity tier
  
  // Market metrics (refreshed periodically)
  marketCap?: number;
  avgVolume24h?: number;
  avgOI?: number;
  avgSpread?: number;
  
  // Eligibility
  hasFutures: boolean;
  eligibilityScore?: number;  // 0..1
  lastEligibilityCheck?: number;
}

// ═══════════════════════════════════════════════════════════════
// ELIGIBILITY RULES
// ═══════════════════════════════════════════════════════════════

export interface EligibilityRules {
  minVolume24h: number;       // USD
  minOpenInterest: number;    // USD
  minDaysListed: number;      // days since listing
  maxSpreadPct: number;       // max bid-ask spread %
  minMarketCap?: number;      // USD (optional)
  excludeTags?: string[];     // e.g. ["STABLECOIN", "WRAPPED"]
  includeTags?: string[];     // if set, only include these
}

export const DEFAULT_ELIGIBILITY_RULES: EligibilityRules = {
  minVolume24h: 10_000_000,   // $10M
  minOpenInterest: 5_000_000, // $5M
  minDaysListed: 14,          // 2 weeks
  maxSpreadPct: 0.5,          // 0.5%
  excludeTags: ['STABLECOIN', 'WRAPPED', 'TESTNET'],
};

// ═══════════════════════════════════════════════════════════════
// UNIVERSE SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface UniverseSnapshot {
  ts: number;
  venue: Venue;
  totalAssets: number;
  eligibleAssets: number;
  assets: UniverseAsset[];
  rules: EligibilityRules;
}

// ═══════════════════════════════════════════════════════════════
// TIER CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export function classifyTier(asset: UniverseAsset): 'TIER1' | 'TIER2' | 'TIER3' {
  const vol = asset.avgVolume24h ?? 0;
  const oi = asset.avgOI ?? 0;
  
  // TIER1: High liquidity (BTC, ETH, SOL, etc.)
  if (vol > 500_000_000 && oi > 200_000_000) return 'TIER1';
  
  // TIER2: Medium liquidity
  if (vol > 50_000_000 && oi > 20_000_000) return 'TIER2';
  
  // TIER3: Everything else
  return 'TIER3';
}

console.log('[Universe] Types loaded');
