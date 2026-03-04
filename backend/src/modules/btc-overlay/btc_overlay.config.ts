/**
 * BTC OVERLAY CONFIG — SPX → BTC Influence Engine Parameters
 */

import type { HorizonKey } from './btc_overlay.contract.js';

export interface BtcOverlayConfig {
  /** Enable SPX → BTC overlay */
  enabled: boolean;
  
  /** Rolling window for beta/correlation calculation */
  rollingWindowDays: Record<HorizonKey, number>;
  
  /** Minimum correlation stability threshold */
  minCorrStability: number;
  
  /** Minimum data quality threshold */
  minQuality: number;
  
  /** Gate thresholds for regime alignment */
  gateThresholds: {
    warning: number;
    blocked: number;
  };
  
  /** Default beta values if calculation fails */
  defaultBeta: Record<HorizonKey, number>;
  
  /** Maximum overlay impact (clamp) */
  maxOverlayImpact: number;
}

export const btcOverlayConfig: BtcOverlayConfig = {
  enabled: true,
  
  // Rolling windows per horizon
  rollingWindowDays: {
    7: 30,
    14: 45,
    30: 90,
    90: 180,
    180: 365,
    365: 730,
  },
  
  minCorrStability: 0.3,
  minQuality: 0.5,
  
  gateThresholds: {
    warning: 0.5,
    blocked: 0.75,
  },
  
  // Empirical beta defaults (BTC typically has negative/low beta to SPX in stress)
  defaultBeta: {
    7: 0.15,
    14: 0.18,
    30: 0.20,
    90: 0.25,
    180: 0.30,
    365: 0.35,
  },
  
  // Don't let overlay impact exceed ±15%
  maxOverlayImpact: 0.15,
};

export function loadBtcOverlayConfig(): BtcOverlayConfig {
  const config = { ...btcOverlayConfig };
  
  if (process.env.BTC_OVERLAY_ENABLED === 'false') {
    config.enabled = false;
  }
  
  return config;
}
