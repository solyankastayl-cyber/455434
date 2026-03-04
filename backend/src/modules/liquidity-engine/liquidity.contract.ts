/**
 * LIQUIDITY ENGINE CONTRACT — P2
 * 
 * Types for Federal Reserve liquidity data:
 * - WALCL: Fed Balance Sheet
 * - RRPONTSYD: Reverse Repo
 * - WTREGEN: Treasury General Account (TGA)
 * 
 * ISOLATION: No imports from DXY/BTC/SPX modules
 */

// ═══════════════════════════════════════════════════════════════
// SERIES DEFINITIONS
// ═══════════════════════════════════════════════════════════════

export const LIQUIDITY_SERIES = {
  WALCL: {
    seriesId: 'WALCL',
    displayName: 'Fed Balance Sheet (Total Assets)',
    frequency: 'weekly' as const,
    units: 'billions',
    sign: +1,  // expansion adds liquidity
  },
  RRPONTSYD: {
    seriesId: 'RRPONTSYD',
    displayName: 'Reverse Repo (ON RRP)',
    frequency: 'daily' as const,
    units: 'billions',
    sign: -1,  // RRP absorbs liquidity
  },
  WTREGEN: {
    seriesId: 'WTREGEN',
    displayName: 'Treasury General Account',
    frequency: 'weekly' as const,
    units: 'billions',
    sign: -1,  // TGA absorbs liquidity
  },
} as const;

export type LiquiditySeriesId = keyof typeof LIQUIDITY_SERIES;

// ═══════════════════════════════════════════════════════════════
// DELTA TYPES
// ═══════════════════════════════════════════════════════════════

export interface LiquidityDeltas {
  delta4w: number | null;   // 4-week change
  delta13w: number | null;  // 13-week change (quarterly)
  delta26w: number | null;  // 26-week change (semi-annual)
}

export interface LiquidityZScores {
  z4w: number | null;   // Z-score of 4w delta
  z13w: number | null;  // Z-score of 13w delta
  z26w: number | null;  // Z-score of 26w delta
}

// ═══════════════════════════════════════════════════════════════
// SERIES CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface LiquiditySeriesContext {
  seriesId: LiquiditySeriesId;
  displayName: string;
  available: boolean;
  
  current: {
    value: number;
    date: string;
  } | null;
  
  deltas: LiquidityDeltas;
  zscores: LiquidityZScores;
  
  // 5-year rolling statistics
  stats: {
    mean5y: number;
    std5y: number;
    min5y: number;
    max5y: number;
  } | null;
}

// ═══════════════════════════════════════════════════════════════
// IMPULSE CALCULATION
// ═══════════════════════════════════════════════════════════════

/**
 * Liquidity Impulse Formula (fixed):
 * 
 * liquidityImpulse = + Z(ΔWALCL) - Z(ΔRRP) - Z(ΔTGA)
 * 
 * Signs important:
 * - WALCL positive → expansion → positive impulse
 * - RRP/TGA absorb liquidity → positive RRP/TGA → negative impulse
 */
export type LiquidityRegime = 'EXPANSION' | 'CONTRACTION' | 'NEUTRAL';

export interface LiquidityState {
  impulse: number;          // -3..+3 range (sum of z-scores)
  regime: LiquidityRegime;
  confidence: number;       // 0..1
  components: {
    walcl: number;          // Z(ΔWALCL)
    rrp: number;            // Z(ΔRRP) (already negated)
    tga: number;            // Z(ΔTGA) (already negated)
  };
}

// ═══════════════════════════════════════════════════════════════
// REGIME RULES (P2.3)
// ═══════════════════════════════════════════════════════════════

/**
 * Regime classification rules:
 * - impulse > +0.75 → EXPANSION
 * - impulse < -0.75 → CONTRACTION
 * - else → NEUTRAL
 */
export const REGIME_THRESHOLDS = {
  EXPANSION_THRESHOLD: 0.75,
  CONTRACTION_THRESHOLD: -0.75,
};

// ═══════════════════════════════════════════════════════════════
// FULL CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface LiquidityContext {
  walcl: LiquiditySeriesContext;
  rrp: LiquiditySeriesContext;
  tga: LiquiditySeriesContext;
  
  state: LiquidityState;
  
  meta: {
    dataQuality: 'GOOD' | 'PARTIAL' | 'MISSING';
    seriesAvailable: number;
    computedAt: string;
    note: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// INGEST RESULTS
// ═══════════════════════════════════════════════════════════════

export interface LiquidityIngestResult {
  seriesId: string;
  ok: boolean;
  pointsWritten: number;
  pointsSkipped: number;
  firstDate?: string;
  lastDate?: string;
  error?: string;
}

export interface LiquidityBulkIngestResult {
  ok: boolean;
  totalSeries: number;
  successCount: number;
  failCount: number;
  results: LiquidityIngestResult[];
  processingTimeMs: number;
}
