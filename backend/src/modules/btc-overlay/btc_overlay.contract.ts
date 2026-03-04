/**
 * BTC OVERLAY CONTRACT — SPX → BTC Influence Engine
 * 
 * Implements Cross-Asset transmission:
 * R_adj = R_btc + g × w × β × R_spx
 * 
 * Where:
 * - R_btc = BTC Hybrid forecast return
 * - R_spx = SPX Final (with DXY overlay) forecast return
 * - β = rolling beta (BTC vs SPX)
 * - ρ = rolling correlation
 * - w = overlay weight = |ρ| × stability × quality
 * - g = guard level (regime alignment)
 */

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type HorizonKey = 7 | 14 | 30 | 90 | 180 | 365;

export interface OverlayCoeffs {
  /** Rolling beta: Cov(BTC, SPX) / Var(SPX) */
  beta: number;
  
  /** Rolling correlation */
  rho: number;
  
  /** Correlation stability: 1 - std(rolling_rho) */
  corrStability: number;
  
  /** Data quality score 0..1 */
  quality: number;
  
  /** Final overlay weight: |rho| × stability × quality, clamped 0..1 */
  overlayWeight: number;
  
  /** Guard/gate level from regime alignment */
  guard: {
    /** Gate value 0..1 (higher = more blocked) */
    gate: number;
    /** Level label */
    level: 'NONE' | 'OK' | 'WARNING' | 'BLOCKED';
    /** Applied multiplier: 1 - gate */
    applied: number;
  };
}

export interface OverlayExplain {
  /** Base BTC Hybrid return */
  baseRet: number;
  /** Driver (SPX) return */
  driverRet: number;
  /** Impact from SPX: g × w × β × R_spx */
  impactRet: number;
  /** Final adjusted return: R_btc + impact */
  finalRet: number;
  /** Formula string for UI */
  formula: string;
  /** Input values */
  inputs: {
    beta: number;
    rho: number;
    w: number;
    g: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// API RESPONSE CONTRACTS
// ═══════════════════════════════════════════════════════════════

export interface OverlayCoeffsResponse {
  meta: {
    base: 'BTC';
    driver: 'SPX';
    horizon: string;
    asOf: string;
  };
  coeffs: OverlayCoeffs;
}

export interface OverlayAdjustedPathResponse {
  meta: {
    base: 'BTC';
    driver: 'SPX';
    horizon: string;
    asOf: string;
    step: string;
    basePrice: number;
  };
  series: {
    /** BTC Hybrid forecast (dashed line) */
    btcHybrid: Array<{ t: string; v: number }>;
    /** SPX Final forecast (dashed line) */
    spxFinal: Array<{ t: string; v: number }>;
    /** BTC Adjusted = Hybrid + SPX influence (main solid line) */
    btcAdjusted: Array<{ t: string; v: number }>;
    /** Bands for adjusted */
    bands?: {
      btcAdjusted80: {
        low: Array<{ t: string; v: number }>;
        high: Array<{ t: string; v: number }>;
      };
    };
  };
  explain: OverlayExplain;
}

export interface OverlayExplainResponse {
  meta: {
    base: 'BTC';
    driver: 'SPX';
    horizon: string;
    asOf: string;
  };
  composition: {
    baseHybrid: { ret: number; label: string };
    driverImpact: { ret: number; label: string };
    finalAdjusted: { ret: number; label: string };
  };
  drivers: {
    beta: number;
    rho: number;
    corrStability: string;
    overlayWeight: number;
    guardLevel: string;
  };
  confidence: {
    signalStrength: 'HIGH' | 'MEDIUM' | 'LOW';
    quality: number;
    notes: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// BTC TERMINAL PACK (SPX-style structure)
// ═══════════════════════════════════════════════════════════════

export interface BtcVerdictStrip {
  marketState: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  directionalBias: string;
  medianProjection: number;
  probableRange: {
    p: number;
    min: number;
    max: number;
  };
  phase: string;
  risk: {
    level: string;
    label: string;
  };
  whatWouldChange: string[];
}

export interface BtcForecastHorizon {
  horizon: string;
  synthetic: number;
  replay: number;
  hybrid: number;
  overlay?: {
    driver: string;
    impact: number;
  };
  final: number;
  confidence: number;
}

export interface BtcTerminalPack {
  ok: boolean;
  asset: 'BTC';
  horizon: string;
  asOf: string;
  processingTimeMs: number;
  dataStatus: 'REAL' | 'DELAYED' | 'SIMULATED';
  quality: {
    score: number;
    label: string;
  };
  
  verdict: BtcVerdictStrip;
  
  forecasts: BtcForecastHorizon[];
  
  /** SPX → BTC overlay data */
  spxOverlay?: {
    enabled: boolean;
    coeffs: OverlayCoeffs;
    explain: OverlayExplain;
  };
  
  /** Historical matches (like SPX) */
  matches?: {
    bestMatch: {
      date: string;
      similarity: number;
      phase: string;
      outcome: number;
    };
    coverageYears: number;
    sampleSize: number;
    items: Array<{
      rank: number;
      date: string;
      similarity: number;
      phase: string;
      outcome: number;
      era: string;
    }>;
  };
  
  /** Phase engine */
  phase?: {
    currentPhase: string;
    historicalPerformance: Array<{
      phase: string;
      successRate: number;
      avgReturn: number;
      riskLevel: string;
    }>;
  };
  
  /** Risk & Position */
  riskPosition?: {
    status: 'TRADE' | 'NO_TRADE' | 'REDUCED';
    riskLevel: string;
    positionSize: number;
    expectedReturn: number;
    riskReward: number;
    worstCase5: number;
    typicalPullback: number;
    reasons: string[];
  };
}
