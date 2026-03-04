/**
 * BLOCK 60 — Regime Context Types
 * 
 * Single source of truth for all policy decisions.
 * Everything downstream depends on this context.
 */

// ═══════════════════════════════════════════════════════════════
// REGIME TYPES
// ═══════════════════════════════════════════════════════════════

export type VolatilityRegime = 'LOW' | 'NORMAL' | 'HIGH' | 'EXPANSION' | 'CRISIS';
export type MarketPhase = 'ACCUMULATION' | 'MARKUP' | 'DISTRIBUTION' | 'MARKDOWN' | 'UNKNOWN';
export type GlobalBias = 'BULL' | 'BEAR' | 'NEUTRAL';
export type ReliabilityBadge = 'OK' | 'WARN' | 'CRITICAL' | 'HALT';

// ═══════════════════════════════════════════════════════════════
// TAIL RISK
// ═══════════════════════════════════════════════════════════════

export interface TailRisk {
  mcP95: number;          // Monte Carlo P95 drawdown
  wfMaxDD: number;        // Walk-forward max drawdown
  currentDD: number;      // Current drawdown from peak
}

// ═══════════════════════════════════════════════════════════════
// RELIABILITY
// ═══════════════════════════════════════════════════════════════

export interface ReliabilityHealth {
  score: number;          // 0-1
  badge: ReliabilityBadge;
  drift: number;          // prediction drift
  calibration: number;    // calibration score
}

// ═══════════════════════════════════════════════════════════════
// REGIME FLAGS
// ═══════════════════════════════════════════════════════════════

export interface RegimeFlags {
  protectionMode: boolean;      // Risk protection active
  frozenOnly: boolean;          // Only frozen signals allowed
  noNewTrades: boolean;         // No new positions
  reduceExposure: boolean;      // Reduce existing exposure
  structureDominates: boolean;  // Long-term structure overrides timing
}

// ═══════════════════════════════════════════════════════════════
// MAIN CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface RegimeContext {
  symbol: string;
  asof: string;
  
  // Core regime
  volRegime: VolatilityRegime;
  phase: MarketPhase;
  bias: GlobalBias;
  
  // Risk metrics
  tailRisk: TailRisk;
  reliability: ReliabilityHealth;
  
  // Volatility details
  volatility: {
    rv30: number;
    rv90: number;
    atr14Pct: number;
    zScore: number;
  };
  
  // Flags derived from context
  flags: RegimeFlags;
  
  // Severity score (0-1, higher = more defensive)
  severityScore: number;
  
  // Explain why this context
  explain: string[];
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT INPUT (from terminal/signals)
// ═══════════════════════════════════════════════════════════════

export interface RegimeContextInput {
  symbol: string;
  
  // From volatility service
  volatility: {
    regime: VolatilityRegime;
    rv30: number;
    rv90: number;
    atr14Pct: number;
    zScore: number;
  };
  
  // From market phase detection
  phase?: MarketPhase;
  
  // From long-term signals (180d/365d)
  structureBias?: GlobalBias;
  structureStrength?: number;
  
  // From reliability service
  reliability?: {
    score: number;
    badge: ReliabilityBadge;
    drift?: number;
    calibration?: number;
  };
  
  // From tail risk metrics
  tailRisk?: {
    mcP95?: number;
    wfMaxDD?: number;
    currentDD?: number;
  };
  
  // Governance overrides
  governanceOverrides?: {
    frozen?: boolean;
    halt?: boolean;
  };
}
