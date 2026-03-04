/**
 * MACRO CONTEXT — Canonical Types (v1.0 LOCKED)
 * 
 * Market State Anchors:
 * - Fear & Greed Index
 * - BTC Dominance
 * - Stablecoin Dominance
 * 
 * RULES:
 * ❌ Macro НЕ решает BUY/SELL
 * ❌ Macro НЕ повышает confidence
 * ❌ Macro НЕ зависит от ML
 * ✅ Только контекст
 * ✅ Только фильтр
 * ✅ Только explainability
 */

// ═══════════════════════════════════════════════════════════════
// FEAR & GREED
// ═══════════════════════════════════════════════════════════════

export type FearGreedLabel = 
  | 'EXTREME_FEAR'   // 0-20
  | 'FEAR'           // 21-35
  | 'NEUTRAL'        // 36-55
  | 'GREED'          // 56-75
  | 'EXTREME_GREED'; // 76-100

export interface FearGreedData {
  value: number;           // 0-100
  label: FearGreedLabel;
  change24h?: number;
  change7d?: number;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// DOMINANCE
// ═══════════════════════════════════════════════════════════════

export interface DominanceData {
  btcPct: number;           // BTC market cap %
  stablePct: number;        // USDT + USDC %
  altPct?: number;          // Everything else
  btcDelta24h?: number;     // Change in 24h
  stableDelta24h?: number;
  timestamp: number;
}

export interface RSIData {
  btcDomRsi14?: number;     // RSI(14) on BTC dominance
  stableDomRsi14?: number;  // RSI(14) on stable dominance
}

// ═══════════════════════════════════════════════════════════════
// MACRO SNAPSHOT (raw data)
// ═══════════════════════════════════════════════════════════════

export type DataQualityMode = 'LIVE' | 'CACHED' | 'DEGRADED' | 'NO_DATA';

export interface DataQuality {
  mode: DataQualityMode;
  latencyMs?: number;
  ttlSec?: number;
  missing: string[];
}

export interface MacroSnapshot {
  ts: number;
  source: string;
  quality: DataQuality;
  fearGreed: FearGreedData;
  dominance: DominanceData;
  rsi: RSIData;
  regimeHints?: {
    riskMode: 'RISK_ON' | 'RISK_OFF' | 'RANGE' | 'UNKNOWN';
    drivers: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// MACRO SIGNAL (what Macro "tells" the engine)
// ═══════════════════════════════════════════════════════════════

export type MacroFlag =
  | 'MACRO_PANIC'
  | 'MACRO_EUPHORIA'
  | 'MACRO_RISK_OFF'
  | 'MACRO_RISK_ON'
  | 'BTC_DOM_UP'
  | 'BTC_DOM_DOWN'
  | 'BTC_DOM_OVERBOUGHT'
  | 'BTC_DOM_OVERSOLD'
  | 'STABLE_INFLOW'
  | 'STABLE_OUTFLOW'
  | 'STABLE_OVERBOUGHT'
  | 'STABLE_OVERSOLD'
  | 'RISK_REVERSAL'
  | 'MACRO_NO_DATA';

export interface MacroSignal {
  ts: number;
  flags: MacroFlag[];
  scores: {
    riskOffScore: number;   // 0-1
    riskOnScore: number;    // 0-1
    confidencePenalty: number; // 0.6-1.0 (multiplier)
  };
  explain: {
    summary: string;
    bullets: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// MACRO IMPACT (what actually applied in Meta-Brain)
// ═══════════════════════════════════════════════════════════════

export interface MacroImpact {
  ts: number;
  applied: boolean;
  confidenceMultiplier: number; // 0.6-1.0
  addedRiskFlags: string[];
  blockedStrong: boolean;       // Block STRONG actions in panic/euphoria
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// RULE TABLES (v1.0 LOCKED)
// ═══════════════════════════════════════════════════════════════

export const FEAR_GREED_RULES: Record<FearGreedLabel, {
  flags: MacroFlag[];
  riskOffScore: number;
  riskOnScore: number;
  confidencePenalty: number;
}> = {
  EXTREME_FEAR: {
    flags: ['MACRO_PANIC'],
    riskOffScore: 1.0,
    riskOnScore: 0.0,
    confidencePenalty: 0.60,
  },
  FEAR: {
    flags: ['MACRO_RISK_OFF'],
    riskOffScore: 0.7,
    riskOnScore: 0.1,
    confidencePenalty: 0.75,
  },
  NEUTRAL: {
    flags: [],
    riskOffScore: 0.3,
    riskOnScore: 0.3,
    confidencePenalty: 0.95,
  },
  GREED: {
    flags: ['MACRO_RISK_ON'],
    riskOffScore: 0.1,
    riskOnScore: 0.6,
    confidencePenalty: 0.90,
  },
  EXTREME_GREED: {
    flags: ['MACRO_EUPHORIA'],
    riskOffScore: 0.4,
    riskOnScore: 0.8,
    confidencePenalty: 0.70,
  },
};

// Thresholds
export const MACRO_THRESHOLDS = {
  BTC_DOM_DELTA_THRESHOLD: 0.5,      // % change to trigger flag
  STABLE_DOM_DELTA_THRESHOLD: 0.3,   // % change to trigger flag
  RSI_OVERBOUGHT: 70,
  RSI_OVERSOLD: 30,
  CONFIDENCE_MIN: 0.6,
  CONFIDENCE_MAX: 1.0,
} as const;

console.log('[MACRO] Types loaded');
