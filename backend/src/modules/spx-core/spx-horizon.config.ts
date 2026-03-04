/**
 * SPX CORE — Horizon Configuration
 * 
 * BLOCK B5.2 — SPX Horizon Settings
 * 
 * Defines the horizons for SPX fractal analysis.
 * ISOLATION: Does NOT import from /modules/btc/ or /modules/fractal/
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SpxHorizonKey = '7d' | '14d' | '30d' | '90d' | '180d' | '365d';

export interface SpxHorizonConfig {
  key: SpxHorizonKey;
  days: number;
  windowLen: number;      // Pattern window length
  aftermathDays: number;  // Forward look period
  topK: number;           // Number of matches to consider
  minHistory: number;     // Minimum candles required
  tier: 'TIMING' | 'TACTICAL' | 'STRUCTURE';
  weight: number;         // Weight in consensus
  description: string;
}

// ═══════════════════════════════════════════════════════════════
// HORIZON CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════
// BLOCK B5.3 — Multi-Horizon Engine
// windowLen = lookback pattern length (bigger for longer horizons)
// aftermathDays = forward look period = horizon days
// topK scales inversely with horizon (short = more samples, long = fewer)

export const SPX_HORIZON_CONFIG: Record<SpxHorizonKey, SpxHorizonConfig> = {
  '7d': {
    key: '7d',
    days: 7,
    windowLen: 30,        // UNIFIED: Short-term patterns
    aftermathDays: 7,
    topK: 25,
    minHistory: 365,
    tier: 'TIMING',
    weight: 0.05,
    description: 'Ultra-short term momentum',
  },
  '14d': {
    key: '14d',
    days: 14,
    windowLen: 45,        // UNIFIED: Short-term patterns
    aftermathDays: 14,
    topK: 25,
    minHistory: 365,
    tier: 'TIMING',
    weight: 0.10,
    description: 'Short term momentum',
  },
  '30d': {
    key: '30d',
    days: 30,
    windowLen: 45,        // UNIFIED: TIMING tier
    aftermathDays: 30,
    topK: 25,
    minHistory: 365,
    tier: 'TIMING',
    weight: 0.20,
    description: 'Monthly tactical',
  },
  '90d': {
    key: '90d',
    days: 90,
    windowLen: 60,        // UNIFIED: TACTICAL tier
    aftermathDays: 90,
    topK: 20,
    minHistory: 1000,
    tier: 'TACTICAL',
    weight: 0.25,
    description: 'Quarterly strategic',
  },
  '180d': {
    key: '180d',
    days: 180,
    windowLen: 120,       // UNIFIED: STRUCTURE tier (4 months)
    aftermathDays: 180,
    topK: 20,
    minHistory: 1500,
    tier: 'STRUCTURE',
    weight: 0.25,
    description: 'Semi-annual structure',
  },
  '365d': {
    key: '365d',
    days: 365,
    windowLen: 180,       // UNIFIED: STRUCTURE tier (6 months)
    aftermathDays: 365,
    topK: 15,
    minHistory: 2500,
    tier: 'STRUCTURE',
    weight: 0.15,
    description: 'Annual cycle',
  },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

export function getSpxHorizonConfig(key: SpxHorizonKey): SpxHorizonConfig {
  return SPX_HORIZON_CONFIG[key];
}

export function getAllSpxHorizons(): SpxHorizonConfig[] {
  return Object.values(SPX_HORIZON_CONFIG);
}

export function getSpxHorizonTier(key: SpxHorizonKey): 'TIMING' | 'TACTICAL' | 'STRUCTURE' {
  return SPX_HORIZON_CONFIG[key].tier;
}

export function isValidSpxHorizon(key: string): key is SpxHorizonKey {
  return key in SPX_HORIZON_CONFIG;
}

export default SPX_HORIZON_CONFIG;
