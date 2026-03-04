/**
 * BLOCK 25 — Sector/Regime Overlay Types
 * =======================================
 * 
 * Context-aware pattern performance adjustment.
 */

import type { Venue } from '../types.js';

// ═══════════════════════════════════════════════════════════════
// REGIME TYPES
// ═══════════════════════════════════════════════════════════════

export type MarketRegime = 'BULL' | 'BEAR' | 'RANGE' | 'RISK_OFF';
export type Sector = 'L1' | 'L2' | 'DEFI' | 'AI' | 'GAMING' | 'MEME' | 'OTHER';

// ═══════════════════════════════════════════════════════════════
// REGIME-SECTOR PERFORMANCE
// ═══════════════════════════════════════════════════════════════

export interface RegimeSectorPerformance {
  regime: MarketRegime;
  sector: Sector;
  
  // Metrics
  hitRate: number;
  avgReturn: number;
  samples: number;
  expectancy: number;
  
  // Comparison
  vsAllRegimes: number;    // % above/below average
  vsAllSectors: number;    // % above/below average
  
  // Recommendation
  multiplier: number;      // Score multiplier (0.5 - 1.5)
  recommendation: 'AVOID' | 'REDUCE' | 'NORMAL' | 'PREFER';
}

// ═══════════════════════════════════════════════════════════════
// SECTOR OVERLAY
// ═══════════════════════════════════════════════════════════════

export interface SectorOverlay {
  sector: Sector;
  
  // Current regime performance
  currentRegimePerf: {
    hitRate: number;
    avgReturn: number;
    samples: number;
  };
  
  // Best/worst regimes
  bestRegime: MarketRegime;
  worstRegime: MarketRegime;
  
  // Overall health
  isHealthy: boolean;
  healthReason: string;
  
  // Active patterns in sector
  activePatterns: number;
  topPattern: string | null;
}

// ═══════════════════════════════════════════════════════════════
// REGIME OVERLAY
// ═══════════════════════════════════════════════════════════════

export interface RegimeOverlay {
  currentRegime: MarketRegime;
  regimeConfidence: number;
  regimeDuration: number;    // hours
  
  // Sector performance in current regime
  sectorRankings: Array<{
    sector: Sector;
    hitRate: number;
    avgReturn: number;
    rank: number;
  }>;
  
  // Pattern performance
  topPatterns: Array<{
    patternId: string;
    label: string;
    hitRate: number;
  }>;
  
  // Recommendations
  preferredSectors: Sector[];
  avoidSectors: Sector[];
}

// ═══════════════════════════════════════════════════════════════
// SRO RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface SROResponse {
  ok: boolean;
  asOf: number;
  venue: Venue;
  
  // Current context
  currentRegime: MarketRegime;
  regimeConfidence: number;
  
  // Overlays
  regimeOverlay: RegimeOverlay;
  sectorOverlays: SectorOverlay[];
  
  // Matrix (regime x sector)
  performanceMatrix: RegimeSectorPerformance[];
  
  // Active adjustments
  activeMultipliers: Array<{
    condition: string;
    multiplier: number;
    reason: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

export const SRO_CONFIG = {
  minSamplesForRecommendation: 10,
  multiplierRange: { min: 0.5, max: 1.5 },
  healthyHitRateThreshold: 0.45,
  preferHitRateThreshold: 0.6,
  avoidHitRateThreshold: 0.35,
} as const;

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function calculateMultiplier(hitRate: number, samples: number): number {
  if (samples < SRO_CONFIG.minSamplesForRecommendation) {
    return 1.0; // Not enough data
  }
  
  // Linear scale: 35% → 0.5x, 50% → 1.0x, 65% → 1.5x
  const normalized = (hitRate - 0.35) / 0.30; // 0 at 35%, 1 at 65%
  const multiplier = 0.5 + normalized * 1.0;
  
  return Math.max(
    SRO_CONFIG.multiplierRange.min,
    Math.min(SRO_CONFIG.multiplierRange.max, multiplier)
  );
}

export function getRecommendation(
  hitRate: number,
  samples: number
): RegimeSectorPerformance['recommendation'] {
  if (samples < SRO_CONFIG.minSamplesForRecommendation) {
    return 'NORMAL';
  }
  
  if (hitRate >= SRO_CONFIG.preferHitRateThreshold) return 'PREFER';
  if (hitRate >= SRO_CONFIG.healthyHitRateThreshold) return 'NORMAL';
  if (hitRate >= SRO_CONFIG.avoidHitRateThreshold) return 'REDUCE';
  return 'AVOID';
}

export function isSectorHealthy(hitRate: number, samples: number): boolean {
  if (samples < 5) return true; // Assume healthy with limited data
  return hitRate >= SRO_CONFIG.healthyHitRateThreshold;
}

console.log('[Block25] Sector/Regime Overlay Types loaded');
