/**
 * HORIZON META CONFIG — Tunable Parameters
 * 
 * Controls:
 * - Feature flags (enabled, mode)
 * - Divergence thresholds per horizon
 * - Decay parameters
 * - Base hierarchy weights
 * - Consensus threshold
 * 
 * Start in SHADOW mode for validation before enabling.
 */

import type { HorizonKey, HorizonMetaMode } from './horizon_meta.contract.js';

// ═══════════════════════════════════════════════════════════════
// MAIN CONFIG
// ═══════════════════════════════════════════════════════════════

export interface HorizonMetaConfig {
  /** Master enable flag */
  enabled: boolean;
  
  /** Mode: "shadow" computes but doesn't apply, "on" applies to verdict */
  mode: HorizonMetaMode;
  
  /** Window size (K days) for divergence evaluation per horizon */
  kWindowByHorizon: Record<HorizonKey, number>;
  
  /** Divergence threshold per horizon (mean abs log return error) */
  thrByHorizon: Record<HorizonKey, number>;
  
  /** Lambda decay factor per horizon (higher = faster decay) */
  lambdaByHorizon: Record<HorizonKey, number>;
  
  /** Minimum decay (floor) */
  decayMin: number;
  
  /** Maximum decay (ceiling) */
  decayMax: number;
  
  /** Base hierarchy weights (sum should be ~1) */
  weightsBase: Record<HorizonKey, number>;
  
  /** Consensus threshold: |bias| > threshold → BULLISH/BEARISH */
  consensusThreshold: number;
}

// ═══════════════════════════════════════════════════════════════
// DEFAULT CONFIG
// ═══════════════════════════════════════════════════════════════

export const horizonMetaConfig: HorizonMetaConfig = {
  // FEATURE FLAGS
  enabled: true,           // Start enabled in shadow mode
  mode: 'shadow',          // 'shadow' = compute but don't apply, 'on' = apply
  
  // DIVERGENCE WINDOWS
  // Shorter horizons use shorter evaluation windows
  kWindowByHorizon: {
    30: 14,    // 14 days for 30D horizon
    90: 21,    // 21 days for 90D horizon
    180: 30,   // 30 days for 180D horizon
    365: 45,   // 45 days for 365D horizon
  },
  
  // DIVERGENCE THRESHOLDS
  // Expressed as mean absolute daily log-return error
  // ~0.01 = 1% daily mean absolute error threshold
  // Shorter horizons more volatile → higher threshold
  thrByHorizon: {
    30: 0.012,   // 1.2% for 30D (more noise)
    90: 0.010,   // 1.0% for 90D
    180: 0.009,  // 0.9% for 180D
    365: 0.008,  // 0.8% for 365D (smoother)
  },
  
  // DECAY LAMBDA
  // decay = exp(-lambda * excess)
  // Higher lambda = faster decay when exceeding threshold
  lambdaByHorizon: {
    30: 0.9,   // Fast decay for tactical
    90: 0.8,
    180: 0.7,
    365: 0.6,  // Slower decay for structural
  },
  
  // DECAY BOUNDS
  decayMin: 0.35,  // Never reduce below 35% of base confidence
  decayMax: 1.0,   // No boost (decay only)
  
  // HIERARCHY WEIGHTS
  // Structural horizons get more weight
  // Sum ≈ 1.0
  weightsBase: {
    30: 0.15,   // Tactical: 15%
    90: 0.25,   // Swing: 25%
    180: 0.25,  // Swing/Structure: 25%
    365: 0.35,  // Structure: 35%
  },
  
  // CONSENSUS THRESHOLD
  // |consensusBias| > 0.25 → directional verdict
  consensusThreshold: 0.25,
};

// ═══════════════════════════════════════════════════════════════
// ENVIRONMENT OVERRIDES
// ═══════════════════════════════════════════════════════════════

export function loadHorizonMetaConfig(): HorizonMetaConfig {
  const config = { ...horizonMetaConfig };
  
  // Allow env overrides
  if (process.env.HORIZON_META_ENABLED === 'false') {
    config.enabled = false;
  }
  if (process.env.HORIZON_META_ENABLED === 'true') {
    config.enabled = true;
  }
  
  if (process.env.HORIZON_META_MODE === 'on') {
    config.mode = 'on';
  }
  if (process.env.HORIZON_META_MODE === 'shadow') {
    config.mode = 'shadow';
  }
  
  return config;
}

// ═══════════════════════════════════════════════════════════════
// PROJECTION TRACKING CONFIG
// ═══════════════════════════════════════════════════════════════

export const projectionTrackingConfig = {
  /** Number of historical projections to keep per asset/horizon */
  maxSnapshots: 30,
  
  /** Minimum days between snapshots (to avoid spam) */
  minSnapshotIntervalDays: 1,
  
  /** Number of projections to show in tracking overlay */
  trackingLookback: 14,
};
