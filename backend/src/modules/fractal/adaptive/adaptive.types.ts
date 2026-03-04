/**
 * BLOCK 61 — Adaptive Horizon Weighting Types
 */

import type { VolatilityRegime, MarketPhase } from '../regime/regime.types.js';

export type HorizonTier = 'STRUCTURE' | 'TACTICAL' | 'TIMING';

export interface TierWeights {
  STRUCTURE: number;  // 180d, 365d
  TACTICAL: number;   // 30d, 90d
  TIMING: number;     // 7d, 14d
}

export interface HorizonWeightPolicy {
  volRegime: VolatilityRegime;
  phase?: MarketPhase;
  weights: TierWeights;
  explain: string;
}

export interface AdaptiveWeightResult {
  baseWeights: TierWeights;
  effectiveWeights: TierWeights;
  adjustments: {
    tier: HorizonTier;
    reason: string;
    delta: number;
  }[];
  explain: string[];
}
