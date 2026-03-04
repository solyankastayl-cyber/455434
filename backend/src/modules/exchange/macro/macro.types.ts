/**
 * BLOCK 2.1 + 2.2 — Macro State Types
 * =====================================
 * BTC Dominance, ETH Dominance, Fear & Greed + Funding Regimes
 */

// ═══════════════════════════════════════════════════════════════
// MACRO REGIMES
// ═══════════════════════════════════════════════════════════════

export type MacroRegime =
  | 'BTC_DOMINANT'      // BTC.D rising, alts weak
  | 'ETH_ROTATION'      // ETH leading, BTC sideways
  | 'ALTSEASON'         // BTC.D falling, alts pumping
  | 'RISK_OFF'          // Fear high, everything down
  | 'RISK_ON'           // Greed high, everything up
  | 'TRANSITION';       // Mixed signals

// ═══════════════════════════════════════════════════════════════
// FUNDING REGIMES
// ═══════════════════════════════════════════════════════════════

export type FundingRegime =
  | 'NEUTRAL'           // Balanced positioning
  | 'CROWD_LONG'        // Funding > threshold, longs crowded
  | 'CROWD_SHORT'       // Funding < -threshold, shorts crowded
  | 'EXTREME_LONG'      // Very high funding, liquidation risk
  | 'EXTREME_SHORT';    // Very low funding, squeeze potential

// ═══════════════════════════════════════════════════════════════
// MACRO STATE
// ═══════════════════════════════════════════════════════════════

export interface MacroState {
  ts: number;
  
  // Dominance
  btcDominance: number;           // %
  btcDominanceDelta24h: number;   // change %
  ethDominance: number;           // %
  ethDominanceDelta24h: number;   // change %
  
  // Sentiment
  fearGreedIndex: number;         // 0-100
  fearGreedLabel: 'EXTREME_FEAR' | 'FEAR' | 'NEUTRAL' | 'GREED' | 'EXTREME_GREED';
  
  // Derived regime
  regime: MacroRegime;
  confidence: number;             // 0-1 confidence in regime classification
  
  // BTC context
  btcPrice: number;
  btcChange24h: number;
  btcTrend: 'UP' | 'DOWN' | 'SIDEWAYS';
}

// ═══════════════════════════════════════════════════════════════
// FUNDING STATE (per symbol or aggregate)
// ═══════════════════════════════════════════════════════════════

export interface FundingState {
  ts: number;
  symbol?: string;                // if null = aggregate market
  
  // Raw values
  avgFunding: number;             // weighted average across venues
  fundingZ: number;               // z-score vs historical
  fundingTrend: 'UP' | 'DOWN' | 'FLAT';
  
  // Venue breakdown
  byVenue: Record<string, number>;  // venue -> funding rate
  dispersion: number;             // std dev across venues
  dominantVenue?: string;         // venue with highest volume
  
  // Classification
  regime: FundingRegime;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// CLUSTER CONTEXT (macro + funding for a cluster)
// ═══════════════════════════════════════════════════════════════

export interface ClusterContext {
  clusterId: string;
  ts: number;
  
  // Macro
  macroRegime: MacroRegime;
  macroConfidence: number;
  
  // Funding
  fundingRegime: FundingRegime;
  fundingConfidence: number;
  avgFunding: number;
  
  // Combined modifier
  contextModifier: number;        // 0.5 - 1.5 multiplier for cluster confidence
  
  // Allowed/penalized
  isAllowed: boolean;
  penaltyReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// CLUSTER-TYPE COMPATIBILITY MATRIX
// ═══════════════════════════════════════════════════════════════

export type ClusterType =
  | 'MOMENTUM'
  | 'MEAN_REVERSION'
  | 'BREAKOUT'
  | 'SQUEEZE'
  | 'CONSOLIDATION';

/**
 * Which cluster types work in which macro regime
 */
export const MACRO_CLUSTER_MATRIX: Record<MacroRegime, Record<ClusterType, number>> = {
  BTC_DOMINANT: {
    MOMENTUM: 0.4,
    MEAN_REVERSION: 0.7,
    BREAKOUT: 0.3,
    SQUEEZE: 0.5,
    CONSOLIDATION: 0.8,
  },
  ETH_ROTATION: {
    MOMENTUM: 0.8,
    MEAN_REVERSION: 0.6,
    BREAKOUT: 0.7,
    SQUEEZE: 0.6,
    CONSOLIDATION: 0.5,
  },
  ALTSEASON: {
    MOMENTUM: 1.0,
    MEAN_REVERSION: 0.5,
    BREAKOUT: 1.0,
    SQUEEZE: 0.7,
    CONSOLIDATION: 0.3,
  },
  RISK_OFF: {
    MOMENTUM: 0.3,
    MEAN_REVERSION: 0.8,
    BREAKOUT: 0.2,
    SQUEEZE: 0.4,
    CONSOLIDATION: 0.9,
  },
  RISK_ON: {
    MOMENTUM: 0.9,
    MEAN_REVERSION: 0.4,
    BREAKOUT: 0.9,
    SQUEEZE: 0.6,
    CONSOLIDATION: 0.3,
  },
  TRANSITION: {
    MOMENTUM: 0.5,
    MEAN_REVERSION: 0.6,
    BREAKOUT: 0.5,
    SQUEEZE: 0.6,
    CONSOLIDATION: 0.6,
  },
};

/**
 * Funding regime modifiers for confidence
 */
export const FUNDING_MODIFIERS: Record<FundingRegime, number> = {
  NEUTRAL: 1.0,
  CROWD_LONG: 0.8,
  CROWD_SHORT: 1.1,
  EXTREME_LONG: 0.55,
  EXTREME_SHORT: 1.25,
};

console.log('[Macro] Types loaded');
