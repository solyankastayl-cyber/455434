/**
 * DXY TERMINAL CONTRACT — A4
 * 
 * Unified terminal response for DXY Fractal Engine.
 * Single endpoint returns: core + synthetic + replay + hybrid + meta
 * 
 * ISOLATION: No imports from /modules/btc or /modules/spx
 */

// ═══════════════════════════════════════════════════════════════
// PATH POINT TYPES
// ═══════════════════════════════════════════════════════════════

export interface TerminalPathPoint {
  t: number;           // day index (0, 1, 2, ...)
  date?: string;       // ISO date string
  value: number;       // absolute price
  pct?: number;        // decimal return from start (0.024 = +2.4%)
}

export interface TerminalBandPack {
  p10: TerminalPathPoint[];
  p50: TerminalPathPoint[];
  p90: TerminalPathPoint[];
}

// ═══════════════════════════════════════════════════════════════
// MATCH INFO
// ═══════════════════════════════════════════════════════════════

export interface TerminalMatchInfo {
  rank: number;
  matchId: string;     // unique identifier (startDate_endDate)
  startDate: string;
  endDate: string;
  similarity: number;  // 0..1
  decade: string;      // e.g. "2010s"
}

// ═══════════════════════════════════════════════════════════════
// CORE PACK
// ═══════════════════════════════════════════════════════════════

export interface TerminalCorePack {
  current: {
    price: number;
    date: string;
  };
  matches: TerminalMatchInfo[];
  diagnostics: {
    similarity: number;        // avg similarity 0..1
    entropy: number;           // 0..1
    coverageYears: number;
    matchCount: number;
    windowLen: number;
  };
  decision: {
    action: "LONG" | "SHORT" | "HOLD";
    size: number;              // 0 or 1
    confidence: number;        // 0..100
    entropy: number;           // 0..1
    reasons: string[];
    regimeBias: "USD_STRENGTHENING" | "USD_WEAKENING";
    forecastReturn: number;    // decimal
  };
}

// ═══════════════════════════════════════════════════════════════
// SYNTHETIC PACK
// ═══════════════════════════════════════════════════════════════

export interface TerminalSyntheticPack {
  path: TerminalPathPoint[];   // p50 median trajectory
  bands: TerminalBandPack;
  forecast: {
    bear: number;   // decimal return
    base: number;   // decimal return
    bull: number;   // decimal return
  };
}

// ═══════════════════════════════════════════════════════════════
// REPLAY PACK
// ═══════════════════════════════════════════════════════════════

export interface TerminalReplayPack {
  matchId: string;
  rank: number;
  similarity: number;
  window: TerminalPathPoint[];        // historical match window (normalized to current)
  continuation: TerminalPathPoint[];  // what happened after in history
}

// ═══════════════════════════════════════════════════════════════
// HYBRID PACK
// ═══════════════════════════════════════════════════════════════

export interface TerminalHybridPack {
  replayWeight: number;  // 0..0.5 (clamped)
  path: TerminalPathPoint[];
  breakdown: {
    modelReturn: number;    // decimal (synthetic endpoint return)
    replayReturn: number;   // decimal (replay continuation return)
    hybridReturn: number;   // decimal (blended return)
  };
}

// ═══════════════════════════════════════════════════════════════
// META
// ═══════════════════════════════════════════════════════════════

export interface TerminalMeta {
  mode: "tactical" | "regime";
  tradingEnabled: boolean;
  configUsed: {
    focus: string;
    windowLen: number;
    threshold: number;
    weightMode: string;
    topK: number;
  };
  warnings: string[];
  // P0-FIX: Explicit windowLen strategy for DXY
  windowLenStrategy: 'fixed' | 'policy';
  policySource: string;  // e.g. "fixed:365" or "horizon-policy"
  // B2: Macro overlay enabled flag
  macroOverlayEnabled?: boolean;
  // P5.1: Health-based confidence adjustment
  confidence?: {
    base: number;
    modifier: number;
    final: number;
    healthGrade: 'HEALTHY' | 'DEGRADED' | 'CRITICAL';
    reasons?: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// B2: MACRO TERMINAL PACK
// ═══════════════════════════════════════════════════════════════

export type MacroRegimeLabel = 
  | 'EASING' 
  | 'TIGHTENING' 
  | 'DISINFLATION' 
  | 'REHEATING' 
  | 'NEUTRAL' 
  | 'STRESS';

export type RiskMode = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
export type Agreement = 'ALIGNED' | 'NEUTRAL' | 'CONFLICT';
export type GuardSeverity = 'INFO' | 'WARN' | 'BLOCK';

export interface MacroRegime {
  label: MacroRegimeLabel;
  riskMode: RiskMode;
  agreementWithSignal: Agreement;
  rates: string;
  inflation: string;
  curve: string;
  labor: string;
  liquidity: string;
}

export interface TradingGuard {
  enabled: boolean;
  reason?: string;
  severity: GuardSeverity;
}

export interface MacroOverlay {
  confidenceMultiplier: number;
  thresholdShift: number;
  tradingGuard: TradingGuard;
}

export interface TerminalMacroPack {
  score01: number;
  scoreSigned: number;
  confidence: number;
  components: Array<{
    key: string;
    pressure: number;
    weight: number;
    contribution: number;
  }>;
  regime: MacroRegime;
  overlay: MacroOverlay;
  updatedAt: string;
  // Macro path with adjustment
  path?: TerminalPathPoint[];
  adjustment?: {
    scoreSigned: number;
    maxAdjustment: number;
    description: string;
    deltaReturnEnd?: number;
  };
  // Band reshaping (v2)
  reshapedBands?: {
    p10: TerminalPathPoint[];
    p90: TerminalPathPoint[];
    reshapeReason: string;
  };
}

// ═══════════════════════════════════════════════════════════════
// BLOCK 77: HORIZON META (Adaptive Similarity + Hierarchy)
// ═══════════════════════════════════════════════════════════════

export interface HorizonMetaSummary {
  enabled: boolean;
  mode: 'shadow' | 'on';
  consensusState?: 'BULLISH' | 'BEARISH' | 'HOLD';
  consensusBias?: number;
  divergenceWarnings?: string[];
  weightsEff?: Record<number, number>;
}

// ═══════════════════════════════════════════════════════════════
// MAIN TERMINAL PACK
// ═══════════════════════════════════════════════════════════════

export interface DxyTerminalPack {
  ok: boolean;
  asset: "DXY";
  focus: string;              // "30d" | "90d" | etc.
  ts: string;                 // ISO timestamp
  processingTimeMs: number;

  meta: TerminalMeta;
  core: TerminalCorePack;
  synthetic: TerminalSyntheticPack;
  replay: TerminalReplayPack;
  hybrid: TerminalHybridPack;
  
  // B2: Macro overlay (optional - null if no macro data)
  macro?: TerminalMacroPack;
  
  // BLOCK 77: Horizon Meta (Adaptive Similarity + Hierarchy)
  horizonMeta?: HorizonMetaSummary;
}

// ═══════════════════════════════════════════════════════════════
// TERMINAL REQUEST PARAMS
// ═══════════════════════════════════════════════════════════════

export interface DxyTerminalParams {
  focus: string;       // "7d" | "14d" | "30d" | "90d" | "180d" | "365d"
  rank?: number;       // 1..10 (default: 1)
  windowLen?: number;  // override config default
  topK?: number;       // override config default (default: 10)
}
