/**
 * BLOCK 58 — Horizon Configuration (BTC-only, frozen)
 * 
 * Centralized configuration for all horizons:
 * - TIMING: 7d, 14d (entry/timing)
 * - TACTICAL: 30d, 90d (position/additions)
 * - STRUCTURE: 180d, 365d (risk-budget/long permission)
 * 
 * windowLen policy:
 *   - windowLen is proportional to horizon but capped
 *   - 7d/14d → 30-45 days (short patterns)
 *   - 30d → 60 days
 *   - 90d → 60 days (same pattern window, different forecast)
 *   - 180d → 120 days (4 months of shape)
 *   - 365d → 180 days (6 months of shape)
 */

import { resolveWindowLen, resolveTier, Tier } from '../../../modules/shared/horizon-policy.service.js';

export type HorizonKey = "7d" | "14d" | "30d" | "90d" | "180d" | "365d";

export const FRACTAL_HORIZONS: HorizonKey[] = ["7d", "14d", "30d", "90d", "180d", "365d"];

export interface HorizonConfig {
  windowLen: number;        // days used for matching
  aftermathDays: number;    // continuation length for forecast
  topK: number;             // number of top matches
  minHistory: number;       // minimum candles required
  label: string;            // human-readable label
  tier: "TIMING" | "TACTICAL" | "STRUCTURE";
}

export const HORIZON_CONFIG: Record<HorizonKey, HorizonConfig> = {
  "7d": {
    windowLen: 30,
    aftermathDays: 7,
    topK: 25,
    minHistory: 100,
    label: "Week",
    tier: "TIMING"
  },
  "14d": {
    windowLen: 45,
    aftermathDays: 14,
    topK: 25,
    minHistory: 150,
    label: "2 Weeks",
    tier: "TIMING"
  },
  "30d": {
    windowLen: 45,
    aftermathDays: 30,
    topK: 25,
    minHistory: 200,
    label: "Month",
    tier: "TIMING"
  },
  "90d": {
    windowLen: 60,
    aftermathDays: 90,
    topK: 20,
    minHistory: 400,
    label: "Quarter",
    tier: "TACTICAL"
  },
  "180d": {
    windowLen: 120,
    aftermathDays: 180,
    topK: 20,
    minHistory: 600,
    label: "Half-Year",
    tier: "STRUCTURE"
  },
  "365d": {
    windowLen: 180,
    aftermathDays: 365,
    topK: 15,
    minHistory: 1000,
    label: "Year",
    tier: "STRUCTURE"
  }
};

// Bias horizons (long-term regime)
export const BIAS_HORIZONS: HorizonKey[] = ["365d", "180d"];

// Timing horizons (entry/exit)
export const TIMING_HORIZONS: HorizonKey[] = ["30d", "14d", "7d"];

// Weights for hierarchical resolver
export const BIAS_WEIGHTS: Record<HorizonKey, number> = {
  "7d": 0,
  "14d": 0,
  "30d": 0,
  "90d": 0,
  "180d": 0.35,
  "365d": 0.65
};

export const TIMING_WEIGHTS: Record<HorizonKey, number> = {
  "7d": 0.20,
  "14d": 0.30,
  "30d": 0.50,
  "90d": 0,
  "180d": 0,
  "365d": 0
};

// Regime weights (for Global Regime Panel)
export const REGIME_WEIGHTS: Record<HorizonKey, number> = {
  "7d": 0,
  "14d": 0,
  "30d": 0.25,
  "90d": 0.50,
  "180d": 0.75,
  "365d": 1.00
};

export function getHorizonConfig(horizon: HorizonKey): HorizonConfig {
  return HORIZON_CONFIG[horizon];
}

export function isValidHorizon(h: string): h is HorizonKey {
  return FRACTAL_HORIZONS.includes(h as HorizonKey);
}
