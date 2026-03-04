/**
 * S10.4 — Liquidation Cascade Types (LOCKED)
 * 
 * Cascade = chain reaction of liquidations that amplifies price movement
 * 
 * NOT a signal, NOT a prediction
 * Just structural diagnosis of market breakdown
 * 
 * DO NOT MODIFY once S10.4 is complete.
 */

import { MarketRegime } from '../regimes/regime.types.js';

// ═══════════════════════════════════════════════════════════════
// CASCADE DIRECTION (which side is being wiped)
// ═══════════════════════════════════════════════════════════════
export type CascadeDirection = 'LONG' | 'SHORT';

// ═══════════════════════════════════════════════════════════════
// CASCADE PHASE (lifecycle stage)
// ═══════════════════════════════════════════════════════════════
export type CascadePhase = 
  | 'START'     // Initial spike in liquidations
  | 'ACTIVE'    // Sustained high liquidation rate
  | 'PEAK'      // Maximum volume + velocity
  | 'DECAY'     // Rate dropping >30%
  | 'END';      // Rate returned to baseline

// ═══════════════════════════════════════════════════════════════
// CASCADE INTENSITY (severity level)
// ═══════════════════════════════════════════════════════════════
export type CascadeIntensity = 
  | 'LOW'       // score < 0.3
  | 'MEDIUM'    // 0.3 ≤ score < 0.6
  | 'HIGH'      // 0.6 ≤ score < 0.85
  | 'EXTREME';  // score ≥ 0.85

// ═══════════════════════════════════════════════════════════════
// CASCADE STATE (main entity)
// ═══════════════════════════════════════════════════════════════
export interface LiquidationCascadeState {
  symbol: string;
  active: boolean;                    // Is cascade currently happening?
  direction: CascadeDirection | null; // LONG or SHORT wipe
  phase: CascadePhase | null;         // Current lifecycle stage
  intensity: CascadeIntensity;        // Severity level
  intensityScore: number;             // 0-1 raw score
  liquidationVolumeUsd: number;       // Total volume liquidated
  oiDeltaPct: number;                 // OI change percentage
  priceDeltaPct: number;              // Price change percentage
  durationSec: number;                // Duration of cascade
  drivers: string[];                  // Human-readable reasons
  regimeContext: MarketRegime;        // Regime when cascade detected
  confidence: number;                 // 0-1 detection confidence
  startedAt: Date | null;             // When cascade started
  timestamp: Date;                    // Last update
}

// ═══════════════════════════════════════════════════════════════
// CASCADE HISTORY ENTRY
// ═══════════════════════════════════════════════════════════════
export interface CascadeHistoryEntry {
  direction: CascadeDirection;
  peakIntensity: CascadeIntensity;
  peakIntensityScore: number;
  totalVolumeUsd: number;
  maxOiDrop: number;
  maxPriceMove: number;
  durationSec: number;
  startedAt: Date;
  endedAt: Date;
  phases: Array<{
    phase: CascadePhase;
    timestamp: Date;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// DETECTION INPUT
// ═══════════════════════════════════════════════════════════════
export interface CascadeDetectionInput {
  liquidationRate: number;           // Events per minute
  liquidationVolumeUsd: number;      // Total volume in window
  longLiqVolume: number;             // Long liquidation volume
  shortLiqVolume: number;            // Short liquidation volume
  oiDeltaPct: number;                // OI change %
  priceVelocity: number;             // Price change rate
  priceDeltaPct: number;             // Price change %
  regime: MarketRegime;              // Current market regime
}

// ═══════════════════════════════════════════════════════════════
// THRESHOLDS (tunable)
// ═══════════════════════════════════════════════════════════════
export interface CascadeThresholds {
  minLiquidationRate: number;         // Min events/min to consider
  minVolumeUsd: number;               // Min volume to trigger
  minOiDrop: number;                  // Min OI drop %
  minPriceMove: number;               // Min price move %
  decayThreshold: number;             // Rate drop % for DECAY phase
  baselineRateMultiplier: number;     // X times baseline = cascade
  // Intensity weights
  volumeWeight: number;
  oiWeight: number;
  priceWeight: number;
}

export const DEFAULT_CASCADE_THRESHOLDS: CascadeThresholds = {
  minLiquidationRate: 5,              // 5+ events per minute
  minVolumeUsd: 500000,               // $500k minimum
  minOiDrop: 1,                       // 1% OI drop
  minPriceMove: 1,                    // 1% price move
  decayThreshold: 30,                 // 30% rate drop = decay
  baselineRateMultiplier: 3,          // 3x baseline = cascade start
  volumeWeight: 0.4,
  oiWeight: 0.35,
  priceWeight: 0.25,
};

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS (for admin)
// ═══════════════════════════════════════════════════════════════
export interface CascadeDiagnostics {
  symbol: string;
  currentState: LiquidationCascadeState;
  rawInputs: {
    recentLiquidations: number;
    totalVolumeUsd: number;
    longVolume: number;
    shortVolume: number;
    oiChange: number;
    priceChange: number;
    currentRegime: MarketRegime;
  };
  computedMetrics: {
    liquidationRate: number;
    intensityScore: number;
    cascadeEligible: boolean;
    eligibilityReason: string;
  };
  thresholds: CascadeThresholds;
  phaseHistory: Array<{
    phase: CascadePhase;
    timestamp: Date;
    reason: string;
  }>;
  history: CascadeHistoryEntry[];
}

// ═══════════════════════════════════════════════════════════════
// REGIMES ELIGIBLE FOR CASCADE (CRITICAL RULE)
// ═══════════════════════════════════════════════════════════════
export const CASCADE_ELIGIBLE_REGIMES: MarketRegime[] = [
  'EXPANSION',
  'LONG_SQUEEZE',
  'SHORT_SQUEEZE',
];
